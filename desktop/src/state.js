'use strict';
/**
 * Small persistent JSON store (userData/ginn-state.json) for everything GinN must be able to undo:
 *   tweaks: { <tweakId>: { entries: { '<KEY>|<name>': {key, name, exists, type, value} } } }
 *   power:  { previous: '<guid>', created: '<guid>'|null, applied: '<guid>' } | null
 *   games:  { <gameId>: { dir, files: [{path, backup:'<file in dir>'|null}] } }
 *   ai:     { model, key: {encrypted:bool, data} | null } | null   (see ai.js; the key is never logged)
 * Writes are atomic (temp file + rename) and serialized.
 */
const fs = require('node:fs');
const path = require('node:path');

function empty() { return { version: 1, tweaks: {}, power: null, games: {}, ai: null }; }

class Store {
  constructor(file) {
    this.file = file;
    this.data = null;
  }

  load() {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = Object.assign(empty(), parsed && typeof parsed === 'object' ? parsed : {});
      if (!this.data.tweaks || typeof this.data.tweaks !== 'object') this.data.tweaks = {};
      if (!this.data.games || typeof this.data.games !== 'object') this.data.games = {};
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Keep a copy of a broken file instead of silently losing backups.
        try { fs.copyFileSync(this.file, this.file + '.broken-' + Date.now()); } catch (x) { /* ignore */ }
      }
      this.data = empty();
    }
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
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

function createStore(file) { return new Store(file); }

module.exports = { createStore, Store };
