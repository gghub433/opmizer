'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const hwm = require('../src/hardware');
const admin = require('../src/admin');

test('pickGpu prefers discrete NVIDIA/AMD with the most VRAM over Intel and virtual adapters', () => {
  const g = hwm.pickGpu([
    { vendor: 'Microsoft', model: 'Microsoft Basic Display Adapter', vram: 0 },
    { vendor: 'Intel Corporation', model: 'Intel(R) UHD Graphics 630', vram: 1024 },
    { vendor: 'NVIDIA', model: 'NVIDIA GeForce RTX 3060', vram: 12288 },
    { vendor: 'Parsec', model: 'Parsec Virtual Display Adapter', vram: 0 }
  ]);
  assert.equal(g.model, 'NVIDIA GeForce RTX 3060');
  assert.equal(hwm.pickGpu([{ vendor: 'AMD', model: 'AMD Radeon(TM) Graphics', vram: 512 }, { vendor: 'AMD', model: 'AMD Radeon RX 7800 XT', vram: 16384 }]).model, 'AMD Radeon RX 7800 XT');
  assert.equal(hwm.pickGpu([]), null);
});

test('generic OEM strings are recognised', () => {
  for (const s of ['To Be Filled By O.E.M.', 'System Product Name', 'Default string', 'All Series', '', '0000']) assert.ok(hwm.isGeneric(s), s);
  assert.ok(!hwm.isGeneric('ROG STRIX B550-F GAMING'));
  assert.equal(hwm.joinName('ASUS', 'ASUS TUF Gaming A15'), 'ASUS TUF Gaming A15');
  assert.equal(hwm.joinName('Lenovo', 'Legion 5'), 'Lenovo Legion 5');
});

test('live sample parsing and thermal-zone sanity filter', () => {
  assert.deepEqual(hwm.parseLiveLine('GINN|37.5|3600|112|3232\r\n'), { gpuLoad: 38, cpuMHz: 4032, tempC: 50.1 });
  assert.deepEqual(hwm.parseLiveLine('GINN||||'), { gpuLoad: null, cpuMHz: null, tempC: null });
  assert.equal(hwm.parseLiveLine('garbage'), null);
  assert.equal(hwm.zoneToC(3010), null, '27.8 C placeholder');
  assert.equal(hwm.zoneToC(0), null);
  assert.equal(hwm.storageType('NVMe'), 'SSD');
  assert.equal(hwm.storageType('HD'), 'HDD');
  assert.equal(hwm.storageType('SSD'), 'SSD');
});

test('hardware(): device name fallbacks, laptop detection, system drive, display from Electron', async () => {
  const si = {
    system: async () => ({ manufacturer: 'To Be Filled By O.E.M.', model: 'To Be Filled By O.E.M.' }),
    baseboard: async () => ({ manufacturer: 'ASRock', model: 'B450M Pro4' }),
    chassis: async () => ({ type: 'Notebook' }),
    osInfo: async () => ({ distro: 'Microsoft Windows 11 Pro', release: '10.0.22631', build: '22631' }),
    cpu: async () => ({ manufacturer: 'AMD', brand: 'Ryzen 5 5600', physicalCores: 6, cores: 12, speedMax: 4.4 }),
    graphics: async () => ({ controllers: [{ vendor: 'NVIDIA', model: 'NVIDIA GeForce RTX 3060', vram: 12288 }], displays: [] }),
    fsSize: async () => [{ fs: 'D:', mount: 'D:', size: 2e12, available: 1e12 }, { fs: 'C:', mount: 'C:', size: 512110190592, available: 107374182400 }],
    diskLayout: async () => [{ type: 'NVMe' }],
    battery: async () => { throw new Error('WMI broke'); },
    currentLoad: async () => ({ currentLoad: 12.4 }),
    cpuCurrentSpeed: async () => ({ avg: 3.9 }),
    cpuTemperature: async () => ({ main: null })
  };
  const hw = hwm.createHardware({
    si, platform: 'win32',
    reg: { readKey: async () => ({ exists: true, values: { displayversion: { value: '23H2' }, currentbuild: { value: '22631' }, ubr: { value: 4317 } } }) },
    ps: async () => ({ code: 1, stdout: '' }),
    session: null,
    getDisplay: () => ({ width: 2560, height: 1440, refreshHz: 164.8 })
  });
  const h = await hw.hardware();
  assert.deepEqual(h.device, { name: 'ASRock B450M Pro4', manufacturer: 'ASRock', model: 'B450M Pro4', type: 'laptop' });
  assert.deepEqual(h.os, { name: 'Windows 11 Pro', version: '23H2', build: '22631.4317' });
  assert.deepEqual(h.cpu, { name: 'AMD Ryzen 5 5600', vendor: 'AMD', cores: 6, threads: 12, maxMHz: 4400, arch: require('node:os').arch() });
  assert.deepEqual(h.gpu, { name: 'NVIDIA GeForce RTX 3060', vramMB: 12288 });
  assert.deepEqual(h.storage, { totalGB: 476.9, freeGB: 100, type: 'SSD' });
  assert.deepEqual(h.display, { width: 2560, height: 1440, refreshHz: 165, maxRefreshHz: 165 });
  assert.equal(h.battery, null, 'failed battery probe -> null, not an exception');
  assert.ok(h.ram.totalMB > 0 && h.ram.availMB > 0);
  const s = await hw.stats();
  assert.equal(s.cpuLoad, 12);
  assert.equal(s.cpuMHz, 3900);
  assert.equal(s.tempC, null);
  assert.equal(s.tempSource, null);
  assert.equal(s.gpuLoad, null);
  assert.ok(s.ramUsedPct >= 0 && s.ramUsedPct <= 100);
});

test('relaunch script asks UAC via Start-Process -Verb RunAs and detects cancel', () => {
  const s = admin.relaunchScript("C:\\Program Files\\GinN\\GinN.exe", ['C:\\dev\\it\'s app']);
  assert.match(s, /Start-Process -FilePath 'C:\\Program Files\\GinN\\GinN\.exe'/);
  assert.match(s, /-ArgumentList @\('"C:\\dev\\it''s app"'\)/);
  assert.match(s, /-Verb RunAs/);
  assert.match(s, /1223/);
  assert.ok(!/-ArgumentList/.test(admin.relaunchScript('C:\\GinN.exe', [])), 'no empty -ArgumentList');
});
