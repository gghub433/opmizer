'use strict';
/** Tiny PNG encoder (RGBA, 8-bit) on node:zlib — enough for texture-pack tiles and icons. */
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, prev) {
  let c = prev === undefined ? 0xFFFFFFFF : (prev ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/**
 * encode(width, height, pixel(x, y) -> [r, g, b, a]) -> PNG Buffer
 */
function encode(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3] === undefined ? 255 : p[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Flat gray tile with a slightly darker 1-px edge so block borders stay readable. */
function grayTile(size, g, edge) {
  const e = Math.max(0, g - (edge === undefined ? 14 : edge));
  return encode(size, size, (x, y) => {
    const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    const v = border ? e : g;
    return [v, v, v, 255];
  });
}

function transparentTile(size) { return encode(size, size, () => [0, 0, 0, 0]); }

module.exports = { encode, crc32, grayTile, transparentTile };
