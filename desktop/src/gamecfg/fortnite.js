'use strict';
/**
 * Fortnite — %LOCALAPPDATA%\FortniteGame\Saved\Config\WindowsClient\GameUserSettings.ini.
 * Only the keys below are touched; every other line (and the file's line endings) is preserved.
 */
const path = require('node:path');
const { HostError } = require('../errors');

const MAIN = '/Script/FortniteGame.FortGameUserSettings';
const SG = 'ScalabilityGroups';

const QUALITY = {
  potato: {
    'sg.ViewDistanceQuality': 0, 'sg.ShadowQuality': 0, 'sg.PostProcessQuality': 0, 'sg.TextureQuality': 0,
    'sg.EffectsQuality': 0, 'sg.FoliageQuality': 0, 'sg.ShadingQuality': 0
  },
  balanced: {
    'sg.ViewDistanceQuality': 2, 'sg.ShadowQuality': 1, 'sg.PostProcessQuality': 1, 'sg.TextureQuality': 2,
    'sg.EffectsQuality': 1, 'sg.FoliageQuality': 1, 'sg.ShadingQuality': 1
  }
};

/** Set key=value inside [section]; creates the key or the whole section when missing. */
function setIni(lines, section, key, value) {
  const head = '[' + section.toLowerCase() + ']';
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === head) { start = i; break; }
  }
  if (start < 0) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push('[' + section + ']', key + '=' + value);
    return;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) { end = i; break; }
  }
  const low = key.toLowerCase() + '=';
  for (let i = start + 1; i < end; i++) {
    if (lines[i].replace(/^\s+/, '').toLowerCase().startsWith(low)) {
      lines[i] = key + '=' + value;
      return;
    }
  }
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, key + '=' + value);
}

function frameRate(fps) {
  const n = Math.round(Number(fps) || 0);
  return n >= 1000 ? 0 : Math.max(30, n); // 0 = unlimited
}

function transformIni(text, opts) {
  const raw = String(text || '');
  const bom = raw.charCodeAt(0) === 0xFEFF ? '\uFEFF' : ''; // keep the file byte-for-byte outside our keys
  const src = bom ? raw.slice(1) : raw;
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const trailing = lines.length && lines[lines.length - 1] === '';
  if (trailing) lines.pop();
  setIni(lines, MAIN, 'FrameRateLimit', frameRate(opts.fps).toFixed(6));
  for (const [k, v] of Object.entries(QUALITY[opts.preset] || QUALITY.potato)) setIni(lines, SG, k, String(v));
  setIni(lines, SG, 'sg.ResolutionQuality', '100');
  return bom + lines.join(eol) + eol;
}

async function plan(io, opts) {
  const p = path.join(io.env.LOCALAPPDATA || '', 'FortniteGame', 'Saved', 'Config', 'WindowsClient', 'GameUserSettings.ini');
  const text = io.env.LOCALAPPDATA ? io.readText(p) : null;
  if (text == null) throw new HostError('NOT_FOUND', 'Не нашёл настройки Fortnite — запусти игру хотя бы один раз');
  const fr = frameRate(opts.fps);
  return {
    files: [{ path: p, data: transformIni(text, opts) }],
    message: 'Профиль Fortnite записан, лимит FPS: ' + (fr === 0 ? 'без ограничения' : fr) +
      '. Fortnite должен быть закрыт, иначе при выходе он перезапишет настройки',
    processes: ['FortniteClient-Win64-Shipping.exe', 'FortniteLauncher.exe']
  };
}

module.exports = { plan, transformIni, setIni, MAIN, SG };
