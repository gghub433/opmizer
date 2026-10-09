'use strict';
/**
 * Small persistent JSON store (userData/ginn-state.json) for everything GinN must be able to undo:
 *   tweaks: { <tweakId>: { entries: { '<KEY>|<name>': {key, name, exists, type, value} } } }
 *   power:  { previous: '<guid>', created: '<guid>'|null, applied: '<guid>' } | null
 *   games:  { <gameId>: { dir, files: [{path, backup:'<file in dir>'|null}] } }
 *   ai:     { model, key: {encrypted:bool, data} | null } | null   (see ai.js; the key is never logged)
 * Writes are atomic (temp file + fsync + rename) and serialized.
 * Only a missing file starts empty. A file that cannot be read right now (locked by an antivirus or backup
 * tool, EMFILE, …) throws FAILED and is retried on the next call — it is never replaced by an empty state.
 */
const fs = require('node:fs');
const path = require('node:path');
const { HostError } = require('./errors');

const READ_FAILED = 'Не удалось прочитать файл с резервными копиями GinN — его держит другая программа. Попробуй ещё раз';

function empty() { return { version: 1, tweaks: {}, power: null, games: {}, ai: null }; }

class Store {
  constructor(file) {
    this.file = file;
    this.data = null;
  }

  load() {
    if (this.data) return this.data;
    let raw;
    try {
      raw = fs.readFileSync(this.file);
    } catch (e) {
      // Nothing is cached on failure, so save() cannot write an empty state over the real backups.
      if (e.code !== 'ENOENT') throw new HostError('FAILED', READ_FAILED, e.code || e.message);
      this.data = empty();
      return this.data;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      // Really broken JSON: keep its bytes next to it (from memory, so a lock on the file cannot stop it).
      try { fs.writeFileSync(this.file + '.broken-' + Date.now(), raw); } catch (x) { /* ignore */ }
    }
    this.data = Object.assign(empty(), parsed && typeof parsed === 'object' ? parsed : {});
    if (!this.data.tweaks || typeof this.data.tweaks !== 'object') this.data.tweaks = {};
    if (!this.data.games || typeof this.data.games !== 'object') this.data.games = {};
    return this.data;
  }

  get(key) { return this.load()[key]; }

  /** Mutate with fn(data) then persist. Returns fn's result. */
  update(fn) {
    const d = this.load();
    const res = fn(d);
    this.save();
    return res;
  }

  save() {
    const d = this.load();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.' + process.pid + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(d, null, 2), 'utf8');
      fs.fsyncSync(fd); // the rename must never land before the data (power loss -> empty file -> lost backups)
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }
}

function createStore(file) { return new Store(file); }

module.exports = { createStore, Store, READ_FAILED };
