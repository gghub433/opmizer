/* GinN — Minecraft Bedrock "GinN Gray" resource pack (.mcpack = zip) built in pure JS:
 * PNG encoder (stored deflate + crc32 + adler32) and zip writer (store method). No canvas.
 * Only terrain blocks are grayed; ores, water, lava and light sources keep their textures. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  /* ------------------------------------------------------------ checksums */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  /** CRC-32 of bytes[start..end). */
  function crc32(bytes, start, end) {
    var c = 0xFFFFFFFF;
    var s = start || 0, e = end == null ? bytes.length : end;
    for (var i = s; i < e; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function adler32(bytes) {
    var a = 1, b = 0;
    for (var i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function concat(parts) {
    var len = 0, i;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* ------------------------------------------------------------------ PNG */

  /** zlib stream with stored (uncompressed) deflate blocks. */
  function zlibStore(data) {
    var parts = [new Uint8Array([0x78, 0x01])];
    var pos = 0;
    do {
      var len = Math.min(65535, data.length - pos);
      var last = pos + len >= data.length;
      var hdr = new Uint8Array(5);
      hdr[0] = last ? 1 : 0;
      hdr[1] = len & 0xFF; hdr[2] = len >>> 8;
      hdr[3] = ~len & 0xFF; hdr[4] = (~len >>> 8) & 0xFF;
      parts.push(hdr, data.subarray(pos, pos + len));
      pos += len;
    } while (pos < data.length);
    var ad = adler32(data);
    parts.push(new Uint8Array([ad >>> 24, (ad >>> 16) & 0xFF, (ad >>> 8) & 0xFF, ad & 0xFF]));
    return concat(parts);
  }

  function pngChunk(type, data) {
    var out = new Uint8Array(12 + data.length);
    var dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  }

  /**
   * RGBA 8-bit PNG. pixel(x, y) -> [r, g, b] or [r, g, b, a].
   * encodePng(16, 16, () => [128,128,128]) -> Uint8Array
   */
  function encodePng(width, height, pixel) {
    var stride = 1 + width * 4;
    var raw = new Uint8Array(height * stride);
    for (var y = 0; y < height; y++) {
      raw[y * stride] = 0; // filter: none
      for (var x = 0; x < width; x++) {
        var p = pixel(x, y), o = y * stride + 1 + x * 4;
        raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = p.length > 3 ? p[3] : 255;
      }
    }
    var ihdr = new Uint8Array(13);
    var dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width); dv.setUint32(4, height);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // RGBA
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return concat([
      new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlibStore(raw)),
      pngChunk('IEND', new Uint8Array(0))
    ]);
  }

  /* ------------------------------------------------------------------ zip */

  function dosDateTime(d) {
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time, date: date };
  }

  /** Zip (store method, UTF-8 names). files: [{name, data:Uint8Array|string}] -> Uint8Array */
  function zip(files) {
    var dt = dosDateTime(new Date());
    var locals = [], centrals = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      var crc = crc32(data);
      var lh = new Uint8Array(30), l = new DataView(lh.buffer);
      l.setUint32(0, 0x04034b50, true);
      l.setUint16(4, 20, true);
      l.setUint16(6, 0x0800, true);
      l.setUint16(8, 0, true);
      l.setUint16(10, dt.time, true);
      l.setUint16(12, dt.date, true);
      l.setUint32(14, crc, true);
      l.setUint32(18, data.length, true);
      l.setUint32(22, data.length, true);
      l.setUint16(26, name.length, true);
      l.setUint16(28, 0, true);
      locals.push(lh, name, data);

      var ch = new Uint8Array(46), c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, dt.time, true);
      c.setUint16(14, dt.date, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      centrals.push(ch, name);

      offset += 30 + name.length + data.length;
    });
    var cd = concat(centrals);
    var end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, cd.length, true);
    e.setUint32(16, offset, true);
    return concat([concat(locals), cd, end]);
  }

  /* -------------------------------------------------------------- base64 */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  /** Uint8Array -> base64 string. */
  function toBase64(u8) {
    var out = '', i;
    for (i = 0; i + 2 < u8.length; i += 3) {
      var n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63];
    }
    var rest = u8.length - i;
    if (rest === 1) {
      var a = u8[i] << 16;
      out += B64[a >> 18 & 63] + B64[a >> 12 & 63] + '==';
    } else if (rest === 2) {
      var b = (u8[i] << 16) | (u8[i + 1] << 8);
      out += B64[b >> 18 & 63] + B64[b >> 12 & 63] + B64[b >> 6 & 63] + '=';
    }
    return out;
  }

  /* --------------------------------------------------------------- pack */

  function uuid4() {
    var r = new Uint8Array(16);
    var c = window.crypto || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && c.getRandomValues) c.getRandomValues(r);
    else for (var i = 0; i < 16; i++) r[i] = Math.floor(Math.random() * 256);
    r[6] = (r[6] & 0x0F) | 0x40;
    r[8] = (r[8] & 0x3F) | 0x80;
    var h = '';
    for (var j = 0; j < 16; j++) h += (r[j] < 16 ? '0' : '') + r[j].toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /**
   * Bedrock texture paths (under textures/blocks/, without .png) -> gray level.
   * Deliberately NOT here: *_ore, water, lava, glowstone, sea lantern, magma, shroomlight, torches.
   */
  var BLOCKS = {
    stone: 125, cobblestone: 112, cobblestone_mossy: 108,
    stonebrick: 120, stonebrick_mossy: 112, stonebrick_cracked: 116, stonebrick_carved: 118,
    stone_granite: 132, stone_granite_smooth: 136, stone_diorite: 170, stone_diorite_smooth: 175,
    stone_andesite: 128, stone_andesite_smooth: 132, stone_slab_top: 140, stone_slab_side: 136,
    dirt: 100, coarse_dirt: 96, dirt_podzol_top: 92, dirt_podzol_side: 98, farmland_dry: 96, farmland_wet: 84,
    grass_top: 150, grass_side: 110, grass_path_top: 130, grass_path_side: 110,
    mycelium_top: 118, mycelium_side: 110,
    sand: 165, red_sand: 150, gravel: 122, clay: 145, snow: 215,
    sandstone_normal: 160, sandstone_top: 165, sandstone_bottom: 158, sandstone_carved: 158, sandstone_smooth: 165,
    red_sandstone_normal: 145, red_sandstone_top: 150, red_sandstone_bottom: 145,
    brick: 130, bookshelf: 128, hardened_clay: 140,
    planks_oak: 138, planks_spruce: 120, planks_birch: 160, planks_jungle: 134, planks_acacia: 140, planks_big_oak: 104,
    log_oak: 118, log_oak_top: 132, log_spruce: 100, log_spruce_top: 120, log_birch: 175, log_birch_top: 150,
    log_jungle: 112, log_jungle_top: 128, log_acacia: 116, log_acacia_top: 130, log_big_oak: 92, log_big_oak_top: 112,
    leaves_oak_opaque: 120, leaves_spruce_opaque: 110, leaves_birch_opaque: 130, leaves_jungle_opaque: 120,
    leaves_acacia_opaque: 120, leaves_big_oak_opaque: 115,
    netherrack: 100, soul_sand: 95, nether_brick: 85, blackstone: 70, blackstone_top: 74, basalt_side: 90, basalt_top: 95,
    end_stone: 175, end_bricks: 170,
    'deepslate/deepslate': 85, 'deepslate/deepslate_top': 88, 'deepslate/cobbled_deepslate': 80,
    tuff: 105, calcite: 195
  };

  function packIcon() {
    // 64x64: brand gradient (#7C5CFF -> #22D3EE) with a gray "block" in the middle
    return encodePng(64, 64, function (x, y) {
      if (x >= 18 && x < 46 && y >= 18 && y < 46) {
        var edge = x === 18 || x === 45 || y === 18 || y === 45;
        return edge ? [92, 92, 100] : [128, 128, 134];
      }
      var t = (x + y) / 126;
      return [Math.round(0x7C + (0x22 - 0x7C) * t), Math.round(0x5C + (0xD3 - 0x5C) * t), Math.round(0xFF + (0xEE - 0xFF) * t)];
    });
  }

  /**
   * Builds the pack. build({name?}) -> Promise<Uint8Array> (zip bytes; save as "GinN Gray.mcpack").
   */
  function build(opts) {
    return new Promise(function (resolve, reject) {
      try {
        var name = (opts && opts.name) || 'GinN Gray';
        var manifest = {
          format_version: 2,
          header: {
            name: name,
            description: 'Серые текстуры для высокого FPS. Руды, вода, лава и свет не тронуты.',
            uuid: uuid4(),
            version: [1, 0, 0],
            min_engine_version: [1, 16, 0]
          },
          modules: [{ type: 'resources', uuid: uuid4(), version: [1, 0, 0] }]
        };
        var files = [
          { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
          { name: 'pack_icon.png', data: packIcon() }
        ];
        var cache = {};
        Object.keys(BLOCKS).forEach(function (block) {
          var g = BLOCKS[block];
          var png = cache[g] || (cache[g] = encodePng(16, 16, function () { return [g, g, g]; }));
          files.push({ name: 'textures/blocks/' + block + '.png', data: png });
        });
        resolve(zip(files));
      } catch (e) {
        reject(e);
      }
    });
  }

  G.mcpack = {
    build: build,
    toBase64: toBase64,
    /** Suggested download name. */
    fileName: 'GinN Gray.mcpack',
    mime: 'application/octet-stream',
    /** Grayed texture paths -> gray level (read-only). */
    blocks: BLOCKS,
    encodePng: encodePng,
    zip: zip,
    crc32: crc32
  };
})(window.GinN);
