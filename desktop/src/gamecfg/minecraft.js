'use strict';
/**
 * Minecraft: Java Edition — %APPDATA%\.minecraft\options.txt (+ optional gray resource pack).
 * options.txt is "key:value" per line; unknown keys are ignored by the game, so missing keys are appended.
 * Revert (revertText) puts back only the keys GinN writes; keybinds and everything else the player changed
 * after the apply stay as they are.
 */
const path = require('node:path');
const png = require('../png');
const zip = require('../zip');
const { HostError } = require('../errors');

const PACK_FILE = 'GinN-Gray.zip';
const PACK_ID = 'file/' + PACK_FILE;
const MAX_FPS_SLIDER = 260; // 260 = "Unlimited" in the video settings
// Data version (options.txt "version:") of 1.20.2, the first release that reads `supported_formats`.
// Older versions compare pack_format 34 with their own format only and call the pack "too new".
const SUPPORTED_FORMATS_SINCE = 3578;

const PRESETS = {
  potato: {
    renderDistance: '4', simulationDistance: '5', graphicsMode: '0', ao: false, renderClouds: '"false"',
    particles: '2', entityShadows: 'false', entityDistanceScaling: '0.5', biomeBlendRadius: '0',
    mipmapLevels: '0', enableVsync: 'false', bobView: 'false'
  },
  balanced: {
    renderDistance: '8', simulationDistance: '8', graphicsMode: '1', ao: true, renderClouds: '"fast"',
    particles: '1', entityShadows: 'true', entityDistanceScaling: '0.75', biomeBlendRadius: '1',
    mipmapLevels: '2', enableVsync: 'false', bobView: 'true'
  }
};

// Every options.txt key GinN may write (resourcePacks / incompatibleResourcePacks are handled per entry).
const MANAGED_KEYS = [...new Set(['maxFps', 'fancyGraphics', ...Object.keys(PRESETS.potato), ...Object.keys(PRESETS.balanced)])];

function parseList(value) {
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.map(String) : null;
  } catch (e) { return null; }
}

/** options.txt text -> {get(k), has(k), put(k, v), remove(k), text()}; the first line of a key wins, order and EOLs kept. */
function optionsDoc(text) {
  const src = String(text || '');
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const find = (k) => lines.findIndex((l) => l.indexOf(':') === k.length && l.startsWith(k));
  return {
    get(k) { const i = find(k); return i < 0 ? null : lines[i].slice(k.length + 1); },
    has(k) { return find(k) >= 0; },
    put(k, v) { const i = find(k); if (i >= 0) lines[i] = k + ':' + v; else lines.push(k + ':' + v); },
    remove(k) { const i = find(k); if (i >= 0) lines.splice(i, 1); },
    text() { return lines.join(eol) + eol; }
  };
}

/**
 * transformOptions(text, {fps, preset, grayTextures}) -> new options.txt text. Idempotent.
 * Existing keys are edited in place (order and every other line preserved), missing keys are appended.
 */
function transformOptions(text, opts) {
  const preset = PRESETS[opts.preset] || PRESETS.potato;
  const doc = optionsDoc(text);

  for (const [k, v] of Object.entries(preset)) {
    if (k === 'ao') {
      // Before 1.19 "ao" was a level 0..2, newer versions use true/false — keep the file's own style.
      const cur = doc.get('ao');
      doc.put('ao', cur !== null && /^\d+$/.test(cur.trim()) ? (v ? '2' : '0') : String(v));
    } else if (k === 'graphicsMode' && !doc.has('graphicsMode') && doc.has('fancyGraphics')) {
      doc.put('fancyGraphics', v === '0' ? 'false' : 'true'); // 1.15 and older
    } else {
      doc.put(k, v);
    }
  }
  const fps = Math.max(10, Math.min(MAX_FPS_SLIDER, Math.round(Number(opts.fps) || 60)));
  doc.put('maxFps', String(fps));

  const cur = doc.get('resourcePacks');
  let packs = cur === null ? [] : (parseList(cur) || []);
  const had = packs.includes(PACK_ID);
  if (opts.grayTextures && !had) packs.push(PACK_ID);       // last = highest priority
  if (!opts.grayTextures && had) packs = packs.filter((p) => p !== PACK_ID);
  if (opts.grayTextures || had) doc.put('resourcePacks', JSON.stringify(packs));

  // incompatibleResourcePacks holds the player's "load it anyway" answers. Before 1.20.2 the gray pack is
  // "too new" and Minecraft drops it from resourcePacks on start unless it is listed there, so GinN lists it.
  // From 1.20.2 it is compatible, and Minecraft does not load a compatible pack that is still listed on that
  // start (it only un-lists it), so there it must not be listed. Unknown version: the list is left alone.
  const inc = doc.get('incompatibleResourcePacks');
  const list = inc === null ? [] : parseList(inc);
  if (list) {
    const version = parseInt(doc.get('version'), 10);
    const listed = list.includes(PACK_ID);
    let want = listed;
    if (opts.grayTextures && Number.isFinite(version)) want = version < SUPPORTED_FORMATS_SINCE;
    else if (!opts.grayTextures && had) want = false; // the pack leaves resourcePacks, its answer goes too
    if (want !== listed) {
      doc.put('incompatibleResourcePacks', JSON.stringify(want ? list.concat(PACK_ID) : list.filter((p) => p !== PACK_ID)));
    }
  }
  return doc.text();
}

/**
 * Undo GinN's part of options.txt: every key GinN writes goes back to its value in the pre-GinN copy
 * (or is removed when that copy did not have it), the gray pack leaves both pack lists unless it was
 * there before. Everything else in the current file (keybinds, settings changed in game) stays.
 */
function revertOptions(text, originalText) {
  const cur = optionsDoc(text);
  const orig = optionsDoc(originalText);
  for (const k of MANAGED_KEYS) {
    const was = orig.get(k);
    if (was === null) cur.remove(k);
    else if (cur.has(k)) cur.put(k, was);
  }
  for (const k of ['resourcePacks', 'incompatibleResourcePacks']) {
    const list = cur.get(k) === null ? null : parseList(cur.get(k));
    const before = orig.get(k);
    if (!list || !list.includes(PACK_ID) || (before !== null && (parseList(before) || []).includes(PACK_ID))) continue;
    const rest = list.filter((p) => p !== PACK_ID);
    if (before === null && !rest.length) cur.remove(k);
    else cur.put(k, JSON.stringify(rest));
  }
  return cur.text();
}

/** gamecfg/index.js revert hook: new text, or undefined = restore the whole pre-GinN copy (the pack zip). */
function revertText(name, current, original) {
  if (String(name).toLowerCase() !== 'options.txt' || original == null) return undefined;
  return revertOptions(current, original);
}

/* ----------------------------------------------------------- gray pack */

// Terrain only. Ores, water, lava, glass and anything that glows are deliberately left alone.
const GRAY = {
  // stone family
  stone: 128, cobblestone: 120, mossy_cobblestone: 116, smooth_stone: 136, stone_bricks: 124, mossy_stone_bricks: 118,
  cracked_stone_bricks: 120, andesite: 132, polished_andesite: 136, diorite: 176, polished_diorite: 182, granite: 140,
  polished_granite: 146, deepslate: 78, deepslate_top: 82, cobbled_deepslate: 72, tuff: 108, calcite: 196,
  bedrock: 60, gravel: 138, clay: 156, bricks: 112, terracotta: 142,
  // dirt & ground
  dirt: 104, coarse_dirt: 100, rooted_dirt: 102, farmland: 96, farmland_moist: 84, mud: 76, packed_mud: 110,
  mud_bricks: 114, grass_block_top: 158, grass_block_side: 104, podzol_top: 112, podzol_side: 104,
  mycelium_top: 128, mycelium_side: 104, dirt_path_top: 140, dirt_path_side: 104, moss_block: 122,
  snow: 230, grass_block_snow: 200,
  // sand
  sand: 186, red_sand: 170, sandstone: 182, sandstone_top: 186, sandstone_bottom: 178,
  red_sandstone: 166, red_sandstone_top: 170, red_sandstone_bottom: 162,
  // wood
  oak_log: 96, oak_log_top: 146, spruce_log: 80, spruce_log_top: 128, birch_log: 196, birch_log_top: 156,
  jungle_log: 92, jungle_log_top: 142, acacia_log: 104, acacia_log_top: 150, dark_oak_log: 70, dark_oak_log_top: 110,
  mangrove_log: 90, mangrove_log_top: 130, cherry_log: 86, cherry_log_top: 150,
  oak_planks: 150, spruce_planks: 118, birch_planks: 170, jungle_planks: 140, acacia_planks: 152,
  dark_oak_planks: 96, mangrove_planks: 120, cherry_planks: 180, bamboo_planks: 168,
  // leaves (biome tint still applies on top of the gray)
  oak_leaves: 150, spruce_leaves: 140, birch_leaves: 156, jungle_leaves: 150, acacia_leaves: 150,
  dark_oak_leaves: 146, mangrove_leaves: 150, azalea_leaves: 132, cherry_leaves: 200,
  // nether & end (non-glowing)
  netherrack: 92, soul_sand: 88, soul_soil: 84, basalt_side: 76, basalt_top: 80, blackstone: 56, blackstone_top: 60,
  end_stone: 200
};
const TRANSPARENT = ['grass_block_side_overlay'];

function packIcon() {
  // 64x64 violet→cyan gradient with a gray block in the middle.
  return png.encode(64, 64, (x, y) => {
    const t = (x + y) / 126;
    if (x >= 18 && x < 46 && y >= 18 && y < 46) {
      const edge = x === 18 || y === 18 || x === 45 || y === 45;
      const v = edge ? 96 : 136;
      return [v, v, v, 255];
    }
    return [Math.round(124 + (34 - 124) * t), Math.round(92 + (211 - 92) * t), Math.round(255 + (238 - 255) * t), 255];
  });
}

function buildGrayPack() {
  const entries = [
    {
      name: 'pack.mcmeta',
      data: JSON.stringify({
        pack: {
          pack_format: 34,
          supported_formats: { min_inclusive: 1, max_inclusive: 999 },
          description: 'GinN: серые текстуры для FPS'
        }
      }, null, 2)
    },
    { name: 'pack.png', data: packIcon() }
  ];
  const cache = new Map();
  for (const [name, g] of Object.entries(GRAY)) {
    if (!cache.has(g)) cache.set(g, png.grayTile(16, g));
    entries.push({ name: 'assets/minecraft/textures/block/' + name + '.png', data: cache.get(g) });
  }
  const clear = png.transparentTile(16);
  for (const name of TRANSPARENT) entries.push({ name: 'assets/minecraft/textures/block/' + name + '.png', data: clear });
  return zip.build(entries);
}

/* -------------------------------------------------------------- plan */

/**
 * plan(io, opts) -> {files:[{path, data}], message}
 * io: {env, exists(p), readText(p)}
 */
async function plan(io, opts) {
  const root = path.join(io.env.APPDATA || '', '.minecraft');
  if (!io.env.APPDATA || !io.exists(root)) {
    throw new HostError('NOT_FOUND', 'Не нашёл Minecraft: Java Edition (папку .minecraft)');
  }
  const optionsPath = path.join(root, 'options.txt');
  const text = io.readText(optionsPath);
  if (text == null) throw new HostError('NOT_FOUND', 'Запусти Minecraft хотя бы один раз, чтобы появился options.txt');
  const files = [{ path: optionsPath, data: transformOptions(text, opts) }];
  if (opts.grayTextures) files.push({ path: path.join(root, 'resourcepacks', PACK_FILE), data: buildGrayPack() });
  const fps = Math.min(MAX_FPS_SLIDER, Math.round(Number(opts.fps) || 60));
  let message = 'Настройки Minecraft записаны' + (opts.grayTextures ? ', серые текстуры подключены' : '') +
    '. Если игра открыта — перезапусти её';
  if (Number(opts.fps) >= MAX_FPS_SLIDER) message += '. FPS без ограничения';
  else message += '. Лимит FPS: ' + fps;
  return { files, message };
}

module.exports = {
  plan, transformOptions, revertOptions, revertText, buildGrayPack, PACK_FILE, PACK_ID, GRAY, PRESETS, SUPPORTED_FORMATS_SINCE
};
