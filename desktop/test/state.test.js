'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/state');

const BACKUPS = {
  version: 1,
  tweaks: { hags: { entries: { a: { key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', name: 'HwSchMode', exists: true, type: 'REG_DWORD', value: 1 } } } },
  power: { previous: '381b4222-f694-41f0-9685-ff5bb260df2e', created: 'd1e2f3a4-0000-4000-8000-00000000abcd', applied: 'd1e2f3a4-0000-4000-8000-00000000abcd' },
  games: {},
  ai: null
};

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-state-'));
  const file = path.join(dir, 'ginn-state.json');
  if (content !== undefined) fs.writeFileSync(file, content);
  return { dir, file };
}

/** Makes reads (and copies) of `file` fail with `code` while `on()` is true, like an antivirus lock on Windows. */
function lockFile(file, code) {
  const orig = { read: fs.readFileSync, copy: fs.copyFileSync };
  let locked = true;
  const fail = () => { const e = new Error(code + ': resource busy or locked'); e.code = code; throw e; };
  fs.readFileSync = function (f, ...a) { if (locked && f === file) fail(); return orig.read.call(this, f, ...a); };
  fs.copyFileSync = function (s, d, ...a) { if (locked && s === file) fail(); return orig.copy.call(this, s, d, ...a); };
  return {
    unlock() { locked = false; },
    restore() { fs.readFileSync = orig.read; fs.copyFileSync = orig.copy; }
  };
}

test('store: a state file that is locked right now throws FAILED and is never replaced by an empty state', () => {
  const text = JSON.stringify(BACKUPS, null, 2);
  const { dir, file } = tmpFile(text);
  for (const code of ['EBUSY', 'EPERM', 'EMFILE']) {
    const s = createStore(file);
    const lock = lockFile(file, code);
    try {
      assert.throws(() => s.update((d) => { d.tweaks.game_mode = { entries: {} }; }), { code: 'FAILED', message: /резервными копиями/ });
      assert.throws(() => s.get('tweaks'), { code: 'FAILED' });
      assert.throws(() => s.save(), { code: 'FAILED' }, 'save() refuses to run without a successful load');
      lock.unlock();
      // next call reads the real file again: every backup is still there
      assert.equal(s.get('tweaks').hags.entries.a.value, 1);
      assert.equal(s.get('power').created, BACKUPS.power.created);
    } finally { lock.restore(); }
    assert.equal(fs.readFileSync(file, 'utf8'), text, code + ': file untouched');
  }
  assert.deepEqual(fs.readdirSync(dir), ['ginn-state.json'], 'no temp or .broken files left');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store: broken JSON is kept byte-for-byte as .broken-<ts> (even when the file cannot be copied), then starts empty', () => {
  const { dir, file } = tmpFile('{"tweaks": {"hags": ');
  const origCopy = fs.copyFileSync; // a copy of the (locked) file itself would be refused
  fs.copyFileSync = () => { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; };
  let s;
  try {
    s = createStore(file);
    assert.deepEqual(s.get('tweaks'), {});
  } finally { fs.copyFileSync = origCopy; }
  const broken = fs.readdirSync(dir).filter((n) => n.startsWith('ginn-state.json.broken-'));
  assert.equal(broken.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, broken[0]), 'utf8'), '{"tweaks": {"hags": ');
  s.update((d) => { d.power = null; });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store: a missing file starts empty; writes are atomic and leave no temp file', () => {
  const { dir, file } = tmpFile();
  const s = createStore(file);
  assert.deepEqual(s.get('games'), {});
  s.update((d) => { d.tweaks.x = { entries: {} }; });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).tweaks, { x: { entries: {} } });
  assert.deepEqual(fs.readdirSync(dir), ['ginn-state.json']);
  assert.deepEqual(createStore(file).get('tweaks'), { x: { entries: {} } });
  fs.rmSync(dir, { recursive: true, force: true });
});
