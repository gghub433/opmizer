'use strict';
/**
 * One long-lived PowerShell process for frequent, cheap queries (performance counters for the monitor).
 * Commands are single-line scripts, executed strictly one at a time; each answer ends with a marker line.
 * If the process dies or a command hangs, it is killed and restarted on the next call.
 */
const { spawn } = require('node:child_process');

const MARK = '__GINN_DONE__';

class PsSession {
  constructor(opts) {
    this.opts = opts || {};
    this.child = null;
    this.buf = '';
    this.pending = null; // {resolve, timer}
    this.queue = Promise.resolve();
    this.closed = false;
  }

  start() {
    if (this.child || this.closed) return;
    const child = this.opts.spawn
      ? this.opts.spawn()
      // Same flags systeminformation uses for its persistent session (proven on real Windows boxes).
      : spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-InputFormat', 'Text',
        '-NoExit', '-Command', '-'],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    this.buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (this.child !== child) return; // output of a process we already gave up on
      this.buf += d;
      const i = this.buf.indexOf(MARK);
      if (i >= 0 && this.pending && this.pending.child === child) {
        const out = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + MARK.length).replace(/^\r?\n/, '');
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve(out);
      }
    });
    const dead = () => {
      if (this.child === child) this.child = null;
      if (this.pending && this.pending.child === child) {
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve(null);
      }
    };
    child.on('error', dead);
    child.on('exit', dead);
    child.stdin.on('error', () => { /* broken pipe: handled by exit */ });
    child.stdin.write("$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n");
  }

  /** exec(line) -> Promise<string|null> (null on failure/timeout). */
  exec(line, timeoutMs) {
    const job = this.queue.then(() => new Promise((resolve) => {
      if (this.closed) return resolve(null);
      this.start();
      if (!this.child) return resolve(null);
      const timer = setTimeout(() => {
        this.pending = null;
        try { this.child && this.child.kill(); } catch (e) { /* ignore */ }
        this.child = null;
        resolve(null);
      }, timeoutMs || 10000);
      this.pending = { resolve, timer, child: this.child };
      try {
        this.child.stdin.write(String(line).replace(/[\r\n]+/g, ' ') + "; Write-Output '" + MARK + "'\n");
      } catch (e) {
        clearTimeout(timer);
        this.pending = null;
        resolve(null);
      }
    }));
    this.queue = job.then(() => undefined, () => undefined);
    return job;
  }

  close() {
    this.closed = true;
    if (this.child) {
      try { this.child.stdin.end('exit\n'); } catch (e) { /* ignore */ }
      const c = this.child;
      setTimeout(() => { try { c.kill(); } catch (e) { /* ignore */ } }, 1000).unref();
      this.child = null;
    }
  }
}

module.exports = { PsSession, MARK };
