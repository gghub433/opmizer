'use strict';
/**
 * Process runner: a thin execFile wrapper that never rejects (callers look at `code`),
 * plus ps() for PowerShell. Tests swap the real runner with setRunner().
 */
const { execFile } = require('node:child_process');

const DEFAULT_TIMEOUT = 20000;
const MAX_BUFFER = 16 * 1024 * 1024;

/* --------------------------------------------------------------- decoding */

// Windows console tools (reg.exe, powercfg, ipconfig) write in the OEM code page when piped.
// On Russian Windows that is CP866; the rest of the world is ASCII for everything we parse.
const CP866_HIGH = (() => {
  const t = new Array(128).fill('?');
  for (let i = 0; i < 48; i++) t[i] = String.fromCharCode(0x0410 + i); // 0x80-0xAF: А..п
  for (let i = 0; i < 16; i++) t[0x60 + i] = String.fromCharCode(0x0440 + i); // 0xE0-0xEF: р..я
  t[0x70] = 'Ё'; t[0x71] = 'ё';
  t[0x7F] = ' '; // 0xFF = NBSP
  return t;
})();

function decode(buf) {
  if (buf == null) return '';
  if (typeof buf === 'string') return buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch (e) {
    let s = '';
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      s += b < 0x80 ? String.fromCharCode(b) : CP866_HIGH[b - 0x80];
    }
    return s;
  }
}

/* ----------------------------------------------------------------- runner */

function realRunner(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, {
      windowsHide: true,
      timeout: opts.timeout || DEFAULT_TIMEOUT,
      maxBuffer: MAX_BUFFER,
      encoding: 'buffer',
      cwd: opts.cwd,
      env: opts.env
    }, (err, stdout, stderr) => {
      let code = 0;
      if (err) {
        if (typeof err.code === 'number') code = err.code;
        else code = err.killed ? -2 : -1; // -1: could not start (ENOENT), -2: timed out
      }
      resolve({
        code,
        stdout: decode(stdout),
        stderr: decode(stderr) || (err && typeof err.code !== 'number' ? String(err.message || err) : ''),
        timedOut: !!(err && err.killed)
      });
    });
  });
}

let runner = realRunner;

/**
 * run(file, args, {timeout, cwd, env}) -> Promise<{code, stdout, stderr, timedOut}>. Never rejects.
 */
function run(file, args, opts) {
  return Promise.resolve()
    .then(() => runner(file, args || [], opts || {}))
    .catch((e) => ({ code: -1, stdout: '', stderr: String((e && e.message) || e), timedOut: false }));
}

/** PowerShell single-quoted literal. */
function psQuote(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
}

/**
 * Run a PowerShell script. The script is passed with -EncodedCommand (UTF-16LE base64) so no
 * quoting of the command line can ever break it; output is forced to UTF-8.
 */
function ps(script, opts) {
  const full = "$ProgressPreference='SilentlyContinue';" +
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' + script;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    Object.assign({ timeout: 30000 }, opts || {}));
}

/** Test hook: setRunner(fn(file, args, opts) -> {code, stdout, stderr}|Promise). setRunner(null) restores. */
function setRunner(fn) { runner = fn || realRunner; }

/** For tests: decode a PowerShell -EncodedCommand argument list back to the script text. */
function decodePsArgs(args) {
  const i = args.indexOf('-EncodedCommand');
  if (i < 0) return null;
  return Buffer.from(args[i + 1], 'base64').toString('utf16le');
}

module.exports = { run, ps, psQuote, setRunner, decode, decodePsArgs };
