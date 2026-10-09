'use strict';
/**
 * Hardware snapshot + live stats for the contract's Hardware / Stats shapes.
 * Every probe is wrapped: a failed or slow probe yields null for its fields, never an exception.
 */
const os = require('node:os');
const regDefault = require('./reg');
const runDefault = require('./run');

const STATIC_TTL = 60 * 1000;
const LIVE_EVERY = 3000;      // GPU load / CPU clock / thermal sample at most every 3 s
const TEMP_EVERY = 5000;
const BATTERY_EVERY = 30000;

const GENERIC = [
  'to be filled by o.e.m.', 'to be filled by oem', 'system product name', 'system manufacturer', 'default string',
  'all series', 'not applicable', 'not specified', 'none', 'n/a', 'na', 'oem', 'o.e.m.', 'invalid', 'type1productconfigid',
  'standard pc (i440fx + piix, 1996)', 'standard pc (q35 + ich9, 2009)', 'unknown', 'undefined', 'x.x', 'xxxxx', '0123456789'
];
const LAPTOP_CHASSIS = /notebook|laptop|portable|sub ?notebook|hand ?held|convertible|detachable|tablet/i;

function isGeneric(s) {
  const t = String(s || '').trim().toLowerCase();
  return !t || GENERIC.includes(t) || /^0+$/.test(t) || /to be filled/.test(t);
}

function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function joinName(manufacturer, model) {
  const m = clean(manufacturer);
  const n = clean(model);
  if (!m) return n;
  if (!n) return m;
  return n.toLowerCase().startsWith(m.toLowerCase()) ? n : m + ' ' + n;
}

function num(x) { return typeof x === 'number' && Number.isFinite(x) ? x : null; }
function round1(x) { return x == null ? null : Math.round(x * 10) / 10; }

/** Pick the gaming GPU: discrete NVIDIA/AMD first, then the largest VRAM; virtual adapters last. */
function pickGpu(controllers) {
  const list = (controllers || []).filter((c) => c && (c.model || c.name));
  if (!list.length) return null;
  const score = (c) => {
    const s = (clean(c.vendor) + ' ' + clean(c.model || c.name)).toLowerCase();
    if (/basic display|basic render|remote|virtual|parsec|vmware|virtualbox|hyper-v|citrix|spacedesk|idd/.test(s)) return -1;
    const vram = num(c.vram) || num(c.memoryTotal) || 0;
    const discrete = /nvidia|geforce|quadro|rtx|gtx/.test(s) || (/amd|ati|radeon/.test(s) && !/radeon\(tm\) graphics$|vega \d+ graphics|radeon graphics$/.test(s));
    return (discrete ? 1e7 : 0) + (/intel|microsoft/.test(s) ? 0 : 1e6) + vram;
  };
  return list.slice().sort((a, b) => score(b) - score(a))[0];
}

function storageType(t) {
  const s = String(t || '').toLowerCase();
  if (!s) return null;
  if (s.includes('nvme') || s.includes('ssd') || s === 'scm') return 'SSD';
  if (s === 'hd' || s.includes('hdd') || s.includes('hard') || s === 'rotational') return 'HDD';
  return null;
}

/** Thermal zone values come in tenths of Kelvin; 3010 (27.85 °C) and 2982 (25.05 °C) are classic "no sensor" placeholders. */
function zoneToC(tenthsK) {
  const k = Number(tenthsK);
  if (!Number.isFinite(k) || k <= 0 || k === 3010 || k === 2982) return null;
  const c = k / 10 - 273.15;
  if (c < 15 || c > 115) return null;
  return round1(c);
}

/** Parse the "GINN|gpu|freq|perf|zone" line printed by the live sampler. */
function parseLiveLine(text) {
  const m = /GINN\|([^|\r\n]*)\|([^|\r\n]*)\|([^|\r\n]*)\|([^|\r\n]*)/.exec(String(text || ''));
  if (!m) return null;
  const f = (s) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : null; };
  const gpu = f(m[1]);
  const freq = f(m[2]);
  const perf = f(m[3]);
  return {
    gpuLoad: gpu == null ? null : Math.max(0, Math.min(100, Math.round(gpu))),
    cpuMHz: freq && perf ? Math.round(freq * perf / 100) : null,
    tempC: zoneToC(m[4])
  };
}

const LIVE_PS = "$g=(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | " +
  "Where-Object { $_.Name -like '*engtype_3D*' } | Measure-Object -Property UtilizationPercentage -Sum).Sum; " +
  "$p=Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter \"Name='_Total'\" -ErrorAction SilentlyContinue; " +
  "$z=(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue | " +
  "Measure-Object -Property HighPrecisionTemperature -Maximum).Maximum; " +
  "Write-Output ('GINN|' + $g + '|' + $p.ProcessorFrequency + '|' + $p.PercentProcessorPerformance + '|' + $z)";

const diskPs = (letter) => "$n=(Get-Partition -DriveLetter " + letter + " -ErrorAction Stop).DiskNumber; " +
  "$d=Get-PhysicalDisk -ErrorAction Stop | Where-Object { [string]$_.DeviceId -eq [string]$n } | Select-Object -First 1; " +
  "Write-Output ('GINN|' + $d.MediaType + '|' + $d.BusType)";

/**
 * @param {object} deps {si, platform, reg, ps, session (PsSession|null), getDisplay():{width,height,refreshHz}|null, now}
 */
function createHardware(deps) {
  const si = deps.si || require('systeminformation');
  const platform = deps.platform || process.platform;
  const reg = deps.reg || regDefault;
  const ps = deps.ps || runDefault.ps;
  const session = deps.session || null;
  const now = deps.now || (() => Date.now());
  const env = deps.env || process.env;
  // System drive letter ("C" almost always, but Windows can live elsewhere).
  const sysLetter = (/^([a-z]):/i.exec(env.SystemDrive || '') || [null, 'C'])[1].toUpperCase();

  function safe(p, ms, fallback) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(fallback), ms);
      Promise.resolve().then(() => p()).then((v) => { clearTimeout(t); resolve(v == null ? fallback : v); },
        () => { clearTimeout(t); resolve(fallback); });
    });
  }

  let staticCache = null;     // {at, data}
  let staticPending = null;

  async function windowsVersion() {
    if (platform !== 'win32') return null;
    try {
      const k = await reg.readKey('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion');
      const v = (n) => (k.values[n] ? k.values[n].value : null);
      return { displayVersion: v('displayversion'), build: v('currentbuild'), ubr: v('ubr') };
    } catch (e) { return null; }
  }

  async function systemDiskType() {
    if (platform !== 'win32') return null;
    const r = await ps(diskPs(sysLetter), { timeout: 15000 });
    const m = /GINN\|([^|\r\n]*)\|([^|\r\n]*)/.exec(r.stdout || '');
    if (!m) return null;
    if (/nvme/i.test(m[2])) return 'SSD';
    return storageType(m[1]);
  }

  async function loadStatic() {
    const [system, board, chassis, osInfo, cpu, graphics, fsSize, disks, battery, winVer, diskType] = await Promise.all([
      safe(() => si.system(), 15000, {}),
      safe(() => si.baseboard(), 15000, {}),
      safe(() => si.chassis(), 15000, {}),
      safe(() => si.osInfo(), 15000, {}),
      safe(() => si.cpu(), 15000, {}),
      safe(() => si.graphics(), 20000, { controllers: [], displays: [] }),
      safe(() => si.fsSize(), 15000, []),
      safe(() => si.diskLayout(), 20000, []),
      safe(() => si.battery(), 15000, {}),
      safe(() => windowsVersion(), 10000, null),
      safe(() => systemDiskType(), 16000, null)
    ]);

    // device
    let manufacturer = '';
    let model = '';
    let name = '';
    if (!isGeneric(system.model) && !isGeneric(system.manufacturer)) {
      manufacturer = clean(system.manufacturer); model = clean(system.model);
      name = joinName(manufacturer, model);
    } else if (!isGeneric(board.model)) {
      manufacturer = isGeneric(board.manufacturer) ? '' : clean(board.manufacturer); model = clean(board.model);
      name = joinName(manufacturer, model);
    } else {
      name = os.hostname();
    }
    const hasBattery = !!(battery && battery.hasBattery);
    const type = hasBattery || LAPTOP_CHASSIS.test(String(chassis.type || '')) ? 'laptop' : 'desktop';

    // os
    let osName = clean(osInfo.distro) || (platform === 'win32' ? 'Windows' : os.type());
    osName = osName.replace(/^Microsoft\s+/i, '');
    let version = clean(osInfo.release) || os.release();
    let build = clean(osInfo.build) || null;
    if (winVer) {
      if (winVer.displayVersion) version = String(winVer.displayVersion);
      if (winVer.build) build = String(winVer.build) + (winVer.ubr != null && winVer.ubr !== '' ? '.' + winVer.ubr : '');
    }

    // cpu
    const cpus = os.cpus() || [];
    const speedMax = num(cpu.speedMax) || num(cpu.speed);
    const cpuOut = {
      name: joinName(cpu.manufacturer, cpu.brand) || (cpus[0] && clean(cpus[0].model)) || null,
      vendor: clean(cpu.manufacturer) || null,
      cores: num(cpu.physicalCores) || num(cpu.cores) || cpus.length || null,
      threads: num(cpu.cores) || cpus.length || null,
      maxMHz: speedMax ? Math.round(speedMax * 1000) : (cpus[0] && cpus[0].speed) || null,
      arch: os.arch()
    };

    // gpu
    const g = pickGpu(graphics.controllers);
    const gpu = g ? { name: clean(g.model || g.name) || null, vramMB: num(g.vram) || num(g.memoryTotal) || null } : { name: null, vramMB: null };

    // storage (system drive)
    let storage = { totalGB: null, freeGB: null, type: null };
    const fsList = Array.isArray(fsSize) ? fsSize : [];
    const sys = platform === 'win32'
      ? fsList.find((f) => String(f.mount || f.fs || '').toUpperCase().startsWith(sysLetter + ':') ||
        String(f.fs || '').toUpperCase().startsWith(sysLetter + ':'))
      : (fsList.find((f) => f.mount === '/') || fsList[0]);
    if (sys && num(sys.size)) {
      const free = num(sys.available) != null ? sys.available : (num(sys.used) != null ? sys.size - sys.used : null);
      storage = { totalGB: round1(sys.size / 1073741824), freeGB: free == null ? null : round1(free / 1073741824), type: null };
    }
    let sType = diskType;
    if (!sType && Array.isArray(disks) && disks.length) {
      const types = [...new Set(disks.map((d) => storageType(d.type || d.interfaceType)).filter(Boolean))];
      if (types.length === 1) sType = types[0];
      else if (disks.length && storageType(disks[0].type || disks[0].interfaceType)) sType = storageType(disks[0].type || disks[0].interfaceType);
    }
    storage.type = sType || null;

    // display: Electron's screen is exact for the primary monitor; systeminformation is the fallback.
    let display = null;
    try { display = deps.getDisplay ? deps.getDisplay() : null; } catch (e) { display = null; }
    if (!display || !display.width) {
      const ds = (graphics.displays || []);
      const d = ds.find((x) => x.main) || ds[0];
      if (d) {
        display = {
          width: num(d.currentResX) || num(d.resolutionX) || null,
          height: num(d.currentResY) || num(d.resolutionY) || null,
          refreshHz: num(d.currentRefreshRate) || null
        };
      }
    }
    const refresh = display && display.refreshHz ? Math.round(display.refreshHz) : null;
    const displayOut = display
      ? { width: display.width || null, height: display.height || null, refreshHz: refresh, maxRefreshHz: refresh }
      : { width: null, height: null, refreshHz: null, maxRefreshHz: null };

    return {
      device: { name, manufacturer: manufacturer || null, model: model || null, type },
      os: { name: osName, version, build },
      cpu: cpuOut,
      gpu,
      ram: { totalMB: Math.round(os.totalmem() / 1048576), availMB: null },
      storage,
      display: displayOut,
      battery: hasBattery
        ? { present: true, level: num(battery.percent), charging: !!battery.isCharging, tempC: null }
        : null
    };
  }

  function staticInfo() {
    if (staticCache && now() - staticCache.at < STATIC_TTL) return Promise.resolve(staticCache.data);
    if (!staticPending) {
      staticPending = loadStatic().then((d) => {
        staticCache = { at: now(), data: d };
        staticPending = null;
        return d;
      }, (e) => { staticPending = null; throw e; });
    }
    return staticPending;
  }

  /* ---- live samplers (stale-while-revalidate: stats() never waits for them) ---- */

  const live = { at: 0, busy: false, gpuLoad: null, cpuMHz: null, tempC: null };
  const temp = { at: 0, busy: false, value: null, misses: 0 };
  const batt = { at: 0, busy: false, level: null, present: null };

  function refreshLive() {
    if (live.busy || now() - live.at < LIVE_EVERY) return;
    live.busy = true;
    live.at = now();
    const job = (platform === 'win32' && session)
      ? session.exec(LIVE_PS, 10000).then((out) => {
        const p = parseLiveLine(out);
        if (p) { live.gpuLoad = p.gpuLoad; live.cpuMHz = p.cpuMHz; live.tempC = p.tempC; }
      })
      : safe(() => si.graphics(), 8000, null).then((g) => {
        const c = g && pickGpu(g.controllers);
        live.gpuLoad = c && num(c.utilizationGpu) != null ? Math.round(c.utilizationGpu) : null;
      });
    job.catch(() => {}).then(() => { live.busy = false; });
  }

  function refreshTemp() {
    if (platform === 'win32') return; // thermal zone comes with the live sample
    if (temp.busy || now() - temp.at < (temp.misses >= 3 ? 300000 : TEMP_EVERY)) return;
    temp.busy = true;
    temp.at = now();
    safe(() => si.cpuTemperature(), 8000, {}).then((t) => {
      const v = num(t && t.main);
      if (v != null && v > 0 && v < 125) { temp.value = round1(v); temp.misses = 0; } else { temp.value = null; temp.misses++; }
    }).then(() => { temp.busy = false; });
  }

  function refreshBattery() {
    if (batt.present === false || batt.busy || now() - batt.at < BATTERY_EVERY) return;
    batt.busy = true;
    batt.at = now();
    safe(() => si.battery(), 10000, {}).then((b) => {
      batt.present = !!(b && b.hasBattery);
      batt.level = batt.present ? num(b.percent) : null;
    }).then(() => { batt.busy = false; });
  }

  let speedCache = { at: 0, mhz: null };

  async function stats() {
    refreshLive();
    refreshTemp();
    refreshBattery();
    const load = await safe(() => si.currentLoad(), 3000, null);
    let mhz = live.cpuMHz;
    if (mhz == null) {
      if (now() - speedCache.at > LIVE_EVERY) {
        const sp = await safe(() => si.cpuCurrentSpeed(), 3000, null);
        speedCache = { at: now(), mhz: sp && num(sp.avg) ? Math.round(sp.avg * 1000) : null };
      }
      mhz = speedCache.mhz;
    }
    const total = os.totalmem();
    const free = os.freemem();
    const tempC = platform === 'win32' ? live.tempC : temp.value;
    return {
      cpuLoad: load && num(load.currentLoad) != null ? Math.round(load.currentLoad) : null,
      cpuMHz: mhz,
      ramUsedPct: total ? Math.round((1 - free / total) * 100) : null,
      ramAvailMB: Math.round(free / 1048576),
      tempC: tempC == null ? null : tempC,
      tempSource: tempC == null ? null : 'cpu',
      batteryLevel: batt.present ? batt.level : null,
      thermal: null,
      gpuLoad: live.gpuLoad
    };
  }

  async function hardware() {
    const s = await staticInfo();
    const out = JSON.parse(JSON.stringify(s));
    out.ram.availMB = Math.round(os.freemem() / 1048576);
    if (out.battery && batt.level != null) out.battery.level = batt.level;
    return out;
  }

  return { hardware, stats };
}

module.exports = { createHardware, pickGpu, isGeneric, parseLiveLine, zoneToC, storageType, joinName };
