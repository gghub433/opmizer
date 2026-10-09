'use strict';
/**
 * Counter-Strike 2 (Steam app 730):
 *   <library>\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\autoexec.cfg — a GinN block with fps_max;
 *   <Steam>\userdata\<id>\730\local\cfg\cs2_video.txt — only keys that already exist are lowered.
 * Revert (revertText) removes only the GinN block / puts back only those keys: the player's own binds and
 * aliases in autoexec.cfg and in-game video changes made after the apply stay.
 */
const path = require('node:path');
const { HostError } = require('../errors');

const BEGIN = '// >>> GinN (не редактируй этот блок вручную)';
const END = '// <<< GinN';

const VIDEO = {
  potato: {
    'setting.shaderquality': '0', 'setting.msaa_samples': '0', 'setting.videocfg_shadow_quality': '0',
    'setting.videocfg_dynamic_shadows': '0', 'setting.videocfg_texture_detail': '0',
    'setting.videocfg_particle_detail': '0', 'setting.videocfg_ao_detail': '0'
  },
  balanced: {
    'setting.shaderquality': '0', 'setting.msaa_samples': '2', 'setting.videocfg_shadow_quality': '1',
    'setting.videocfg_dynamic_shadows': '1', 'setting.videocfg_texture_detail': '1',
    'setting.videocfg_particle_detail': '1', 'setting.videocfg_ao_detail': '0'
  }
};

function fpsValue(fps) {
  const n = Math.round(Number(fps) || 0);
  return n >= 1000 ? 0 : Math.max(30, n); // fps_max 0 = no limit
}

function ginnBlock(opts, eol) {
  return [
    BEGIN,
    'fps_max ' + fpsValue(opts.fps),
    'fps_max_ui 120',
    END
  ].join(eol);
}

/** Insert or replace the GinN block in autoexec.cfg text; user lines stay untouched. Idempotent. */
function transformAutoexec(text, opts) {
  const src = String(text || '');
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const block = ginnBlock(opts, eol);
  const b = src.indexOf(BEGIN);
  const e = b >= 0 ? src.indexOf(END, b) : -1;
  if (b >= 0 && e >= 0) return src.slice(0, b) + block + src.slice(e + END.length);
  if (!src.trim()) return block + eol;
  return src.replace(/\s*$/, '') + eol + eol + block + eol;
}

/** autoexec.cfg text without the GinN block (and the blank line GinN put before it); other lines untouched. */
function removeAutoexecBlock(text) {
  const src = String(text || '');
  const b = src.indexOf(BEGIN);
  const e = b >= 0 ? src.indexOf(END, b) : -1;
  if (b < 0 || e < 0) return src;
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const before = src.slice(0, b).replace(/\s*$/, '');
  const after = src.slice(e + END.length).replace(/^[ \t]*\r?\n/, '');
  if (!before) return after;
  return after.trim() ? before + eol + after : before + eol;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function videoRe(k) { return new RegExp('^([ \\t]*"' + escapeRe(k) + '"[ \\t]+")([^"\\r\\n]*)(")', 'mi'); }

/** Set "key" "value" pairs of cs2_video.txt in place — only keys that are already in the file. */
function setVideo(text, values) {
  let out = String(text || '');
  for (const [k, v] of Object.entries(values)) out = out.replace(videoRe(k), (m, a, old, c) => a + v + c);
  return out;
}

function transformVideo(text, preset) {
  return setVideo(text, VIDEO[preset] || VIDEO.potato);
}

/** Every key GinN lowers goes back to its value in the pre-GinN copy; nothing else changes. */
function revertVideo(text, originalText) {
  const before = {};
  for (const k of Object.keys(VIDEO.potato)) {
    const m = videoRe(k).exec(String(originalText || ''));
    if (m) before[k] = m[2];
  }
  return setVideo(text, before);
}

/**
 * gamecfg/index.js revert hook -> new text, null = delete the file (GinN created it and only its block
 * is in it), undefined = restore the whole pre-GinN copy.
 */
function revertText(name, current, original) {
  const n = String(name).toLowerCase();
  if (n === 'autoexec.cfg') {
    const out = removeAutoexecBlock(current);
    return original == null && !out.trim() ? null : out;
  }
  if (n === 'cs2_video.txt' && original != null) return revertVideo(current, original);
  return undefined;
}

/**
 * io: {games (createGames instance), exists(p), readText(p), list(dir)}
 */
async function plan(io, opts) {
  const app = await io.games.steamAppDir(730);
  if (!app.dir) throw new HostError('NOT_FOUND', 'Не нашёл Counter-Strike 2 в библиотеках Steam');
  const cfgDir = path.join(app.dir, 'game', 'csgo', 'cfg');
  if (!io.exists(cfgDir)) throw new HostError('NOT_FOUND', 'Не нашёл папку настроек CS2 — проверь целостность файлов игры в Steam');
  const autoexec = path.join(cfgDir, 'autoexec.cfg');
  const files = [{ path: autoexec, data: transformAutoexec(io.readText(autoexec) || '', opts) }];

  let videos = 0;
  if (app.root) {
    const ud = path.join(app.root, 'userdata');
    for (const id of io.list(ud)) {
      if (!/^\d+$/.test(id)) continue;
      const p = path.join(ud, id, '730', 'local', 'cfg', 'cs2_video.txt');
      const t = io.readText(p);
      if (t == null) continue;
      files.push({ path: p, data: transformVideo(t, opts.preset) });
      videos++;
    }
  }
  const fps = fpsValue(opts.fps);
  let message = 'Профиль CS2 записан: fps_max ' + (fps === 0 ? '0 (без ограничения)' : fps);
  message += videos ? ', графика понижена' : '. Файл графики не нашёл — запусти CS2 один раз и примени снова';
  message += '. Если fps_max не сработал, добавь в параметры запуска Steam: +exec autoexec';
  return { files, message, processes: ['cs2.exe'] };
}

module.exports = { plan, transformAutoexec, transformVideo, removeAutoexecBlock, revertVideo, revertText, BEGIN, END, VIDEO };
