'use strict';
/**
 * Counter-Strike 2 (Steam app 730):
 *   <library>\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\autoexec.cfg — a GinN block with fps_max;
 *   <Steam>\userdata\<id>\730\local\cfg\cs2_video.txt — only keys that already exist are lowered.
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

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Edit "key" "value" pairs of cs2_video.txt in place — only keys that are already in the file. */
function transformVideo(text, preset) {
  let out = String(text || '');
  const values = VIDEO[preset] || VIDEO.potato;
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp('^([ \\t]*"' + escapeRe(k) + '"[ \\t]+")([^"\\r\\n]*)(")', 'mi');
    out = out.replace(re, (m, a, old, c) => a + v + c);
  }
  return out;
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

module.exports = { plan, transformAutoexec, transformVideo, BEGIN, END, VIDEO };
