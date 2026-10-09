'use strict';
/**
 * Fortnite — %LOCALAPPDATA%\FortniteGame\Saved\Config\WindowsClient\GameUserSettings.ini.
 * Only the keys below are touched; every other line (and the file's line endings) is preserved.
 * Revert (revertText) puts back only those keys, so in-game changes made after the apply stay.
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

/** {start, end} line range of [section] (start = its header line, end exclusive), or null. */
function sectionRange(lines, section) {
  const head = '[' + section.toLowerCase() + ']';
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === head) { start = i; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/** Index of the key=… line inside [section], or -1. */
function keyLine(lines, section, key) {
  const r = sectionRange(lines, section);
  if (!r) return -1;
  const low = key.toLowerCase() + '=';
  for (let i = r.start + 1; i < r.end; i++) {
    if (lines[i].replace(/^\s+/, '').toLowerCase().startsWith(low)) return i;
  }
  return -1;
}

/** Set key=value inside [section]; creates the key or the whole section when missing. */
function setIni(lines, section, key, value) {
  const r = sectionRange(lines, section);
  if (!r) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push('[' + section + ']', key + '=' + value);
    return;
  }
  const i = keyLine(lines, section, key);
  if (i >= 0) {
    lines[i] = key + '=' + value;
    return;
  }
  let at = r.end;
  while (at > r.start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, key + '=' + value);
}

function getIni(lines, section, key) {
  const i = keyLine(lines, section, key);
  return i < 0 ? null : lines[i].slice(lines[i].indexOf('=') + 1);
}

/** Drops [section] when it holds nothing but blank lines, together with the blank line before it. */
function dropEmptySection(lines, section) {
  const r = sectionRange(lines, section);
  if (!r) return;
  for (let i = r.start + 1; i < r.end; i++) if (lines[i].trim() !== '') return;
  const from = r.start > 0 && lines[r.start - 1].trim() === '' ? r.start - 1 : r.start;
  lines.splice(from, (r.end === lines.length ? r.end : r.start + 1) - from);
}

function frameRate(fps) {
  const n = Math.round(Number(fps) || 0);
  return n >= 1000 ? 0 : Math.max(30, n); // 0 = unlimited
}

/** INI text -> {bom, eol, lines} (keeps the file byte-for-byte outside the keys GinN edits). */
function iniDoc(text) {
  const raw = String(text || '');
  const bom = raw.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '';
  const src = bom ? raw.slice(1) : raw;
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { bom, eol, lines };
}

function iniText(d) { return d.bom + d.lines.join(d.eol) + d.eol; }

// Every [section, key] GinN writes.
const MANAGED = [[MAIN, 'FrameRateLimit']].concat(Object.keys(QUALITY.potato).concat('sg.ResolutionQuality').map((k) => [SG, k]));

function transformIni(text, opts) {
  const d = iniDoc(text);
  setIni(d.lines, MAIN, 'FrameRateLimit', frameRate(opts.fps).toFixed(6));
  for (const [k, v] of Object.entries(QUALITY[opts.preset] || QUALITY.potato)) setIni(d.lines, SG, k, String(v));
  setIni(d.lines, SG, 'sg.ResolutionQuality', '100');
  return iniText(d);
}

/**
 * Every key GinN writes goes back to its value in the pre-GinN copy, or is removed when that copy did not
 * have it (with a section GinN added, once it is empty). Every other line stays as it is now.
 */
function revertIni(text, originalText) {
  const d = iniDoc(text);
  const orig = iniDoc(originalText).lines;
  for (const [section, key] of MANAGED) {
    const was = getIni(orig, section, key);
    const i = keyLine(d.lines, section, key);
    if (i < 0) continue;
    if (was === null) d.lines.splice(i, 1);
    else setIni(d.lines, section, key, was);
  }
  for (const section of [MAIN, SG]) if (!sectionRange(orig, section)) dropEmptySection(d.lines, section);
  return iniText(d);
}

/** gamecfg/index.js revert hook: new text, or undefined = restore the whole pre-GinN copy. */
function revertText(name, current, original) {
  if (String(name).toLowerCase() !== 'gameusersettings.ini' || original == null) return undefined;
  return revertIni(current, original);
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

module.exports = { plan, transformIni, revertIni, revertText, setIni, MAIN, SG };
