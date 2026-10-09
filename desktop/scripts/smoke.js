'use strict';
/**
 * Electron smoke test: starts the real app with GINN_SMOKE=1 under the current DISPLAY
 * (run as `xvfb-run -a npm run smoke` on a headless box), relays its output and exit code.
 * main.js answers with "GINN_SMOKE_RESULT <json>" (info/hardware/stats/tweaks/games) and
 * "GINN_SMOKE_AI <json>" (AI key round-trip, no network).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let electron;
try { electron = require(path.join(root, 'node_modules', 'electron')); } catch (e) {
  console.error('[smoke] electron is not installed — run npm install');
  process.exit(1);
}

// Throwaway profile: the smoke run never touches the real GinN state (backups, AI key).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-smoke-'));
const cleanup = () => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { /* best effort */ } };

const child = spawn(electron, ['--no-sandbox', root], {
  cwd: root,
  env: Object.assign({}, process.env, { GINN_SMOKE: '1', GINN_SMOKE_USERDATA: userData, ELECTRON_ENABLE_LOGGING: '0' }),
  stdio: ['ignore', 'pipe', 'pipe']
});

let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => process.stderr.write(d));

const killer = setTimeout(() => {
  console.error('[smoke] no answer in 40 s — killing electron');
  child.kill('SIGKILL');
}, 40000);

child.on('exit', (code, signal) => {
  clearTimeout(killer);
  cleanup();
  const line = out.split(/\r?\n/).find((l) => l.startsWith('GINN_SMOKE_RESULT '));
  if (!line) {
    console.error('[smoke] FAIL: no GINN_SMOKE_RESULT line (exit ' + code + (signal ? ', ' + signal : '') + ')');
    process.exit(1);
  }
  let res = null;
  try { res = JSON.parse(line.slice('GINN_SMOKE_RESULT '.length)); } catch (e) { /* reported below */ }
  const names = ['info', 'hardware', 'stats', 'tweaks', 'games'];
  if (Array.isArray(res)) {
    res.forEach((r, i) => console.log('[smoke] ' + names[i] + ': ' + (r && r.ok ? 'ok' : 'FAIL ' + JSON.stringify(r))));
    const caps = res[0] && res[0].ok && res[0].data ? res[0].data.capabilities : null;
    console.log('[smoke] capabilities: ' + JSON.stringify(caps));
  }
  const aiLine = out.split(/\r?\n/).find((l) => l.startsWith('GINN_SMOKE_AI '));
  let ai = null;
  try { ai = aiLine ? JSON.parse(aiLine.slice('GINN_SMOKE_AI '.length)) : null; } catch (e) { /* reported below */ }
  if (!ai) console.log('[smoke] ai: FAIL (no GINN_SMOKE_AI line)');
  else {
    console.log('[smoke] ai: ' + (ai.ok ? 'ok (key storage: ' + ai.keyStorage + ')' : 'FAIL ' + JSON.stringify(ai.failed)));
    console.log('[smoke] ai transport (SDK over net.fetch -> local fake API): ' + JSON.stringify(ai.transport));
  }
  console.log('[smoke] ' + (code === 0 ? 'PASS' : 'FAIL') + ' (electron exit ' + code + ')');
  process.exit(code === 0 ? 0 : 1);
});
