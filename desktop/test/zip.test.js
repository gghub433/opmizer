'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const zip = require('../src/zip');
const png = require('../src/png');
const mc = require('../src/gamecfg/minecraft');

/** Independent reader: walks the central directory and inflates every entry, checking CRCs. */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(buf.readUInt32LE(off), 0x04034b50);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const body = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.equal(png.crc32(data), crc, 'crc ' + name);
    out.set(name, data);
    p += 46 + nlen + elen + clen;
  }
  return out;
}

test('crc32 matches the reference value', () => {
  assert.equal(png.crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('png encoder writes a valid 16x16 RGBA image', () => {
  const b = png.grayTile(16, 128);
  assert.deepEqual([...b.slice(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert.equal(b.toString('ascii', 12, 16), 'IHDR');
  assert.equal(b.readUInt32BE(16), 16);
  assert.equal(b.readUInt32BE(20), 16);
  assert.equal(b[25], 6, 'RGBA');
  const idatLen = b.readUInt32BE(33);
  const raw = zlib.inflateSync(b.slice(41, 41 + idatLen));
  assert.equal(raw.length, (16 * 4 + 1) * 16);
  assert.deepEqual([...raw.slice(1 + 4 * 5 + 16 * 4 + 1, 1 + 4 * 5 + 16 * 4 + 1 + 4)], [128, 128, 128, 255], 'inner pixel');
});

test('gray resource pack: valid zip, pack.mcmeta, terrain textures only', () => {
  const buf = mc.buildGrayPack();
  const files = readZip(buf);
  const meta = JSON.parse(files.get('pack.mcmeta').toString('utf8'));
  assert.equal(meta.pack.pack_format, 34);
  assert.deepEqual(meta.pack.supported_formats, { min_inclusive: 1, max_inclusive: 999 });
  assert.ok(files.has('pack.png'));
  for (const n of ['stone', 'dirt', 'grass_block_top', 'oak_log', 'oak_planks', 'oak_leaves', 'sand', 'cobblestone', 'deepslate']) {
    const f = files.get('assets/minecraft/textures/block/' + n + '.png');
    assert.ok(f, n);
    assert.equal(f.toString('ascii', 1, 4), 'PNG');
  }
  for (const name of files.keys()) {
    assert.ok(!/ore|water|lava|glowstone|lantern|torch|shroomlight|magma|glass|ice/.test(name), 'must not touch ' + name);
  }
  assert.deepEqual(mc.buildGrayPack(), buf, 'deterministic output');
});

test('zip passes `unzip -t` when unzip is available', (t) => {
  const has = spawnSync('unzip', ['-v'], { stdio: 'ignore' });
  if (has.error || has.status !== 0) { t.skip('unzip not installed'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ginn-zip-'));
  const p = path.join(dir, 'GinN-Gray.zip');
  fs.writeFileSync(p, mc.buildGrayPack());
  const r = spawnSync('unzip', ['-t', p], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /No errors detected/);
  const small = path.join(dir, 'mixed.zip');
  fs.writeFileSync(small, zip.build([{ name: 'a.txt', data: 'x' }, { name: 'папка/б.txt', data: 'тест '.repeat(100) }]));
  const r2 = spawnSync('unzip', ['-t', small], { encoding: 'utf8' });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
