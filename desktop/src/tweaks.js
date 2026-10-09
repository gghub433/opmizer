'use strict';
/**
 * Windows tweaks: a declarative registry engine plus custom handlers (power plan, cleanup, links).
 *
 * Registry entry: {key, name, type:'REG_DWORD'|'REG_SZ', on, off, missingAs?}
 *   on        value written when the tweak is enabled
 *   off       documented Windows default, written when disabling without a backup (null = delete the value)
 *   missingAs value Windows assumes when the value does not exist (used only to read the state)
 *
 * A toggle is 'on' iff every entry currently equals its `on` value.
 * Before the first apply every entry's previous {exists,type,value} is stored in the state file
 * (an existing backup is never overwritten). Disabling restores those backups exactly
 * (values that did not exist are deleted); without a backup it falls back to `off`.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { HostError, unsupported } = require('./errors');
const regDefault = require('./reg');
const runDefault = require('./run');

const HKCU_GCS = 'HKCU\\System\\GameConfigStore';
const MM = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';
const TCPIP_IF = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces';
const DW = 'REG_DWORD';
const SZ = 'REG_SZ';

const NEEDS_ADMIN_MSG = 'Нужны права администратора — перезапусти GinN от имени администратора';
const OTHER_USER_MSG = 'GinN открыт от имени другой учётной записи (администратора) — эта настройка поменялась бы у неё, ' +
  'а не у тебя. Включи её в GinN, открытом обычным способом';

/* ------------------------------------------------------------- power plan */

const SCHEME = {
  ultimate: 'e9a42b02-d5df-448d-aa00-03f14749eb61',
  high: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e'
};
const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PERF_NAME_RE = /(ultimate|high)\s+performance|(максимальн|высок|наивысш)\S*\s+производительн/i;

/** One powercfg line -> {guid, name, active} | null. Works for any UI language: only the GUID is parsed strictly. */
function parseSchemeLine(line) {
  const m = GUID_RE.exec(line || '');
  if (!m) return null;
  const rest = line.slice(m.index + m[0].length);
  const n = /\(([^()]*)\)/.exec(rest);
  return { guid: m[0].toLowerCase(), name: n ? n[1].trim() : '', active: /\*\s*$/.test(rest) };
}

function parseActiveScheme(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = parseSchemeLine(line);
    if (s) return s;
  }
  return null;
}

function parseSchemeList(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = parseSchemeLine(line);
    if (s) out.push(s);
  }
  return out;
}

/** GUID printed by `powercfg -duplicatescheme <src>` (the new one, never the source). */
function parseDuplicated(text, src) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = parseSchemeLine(line);
    if (s && s.guid !== String(src).toLowerCase()) return s.guid;
  }
  return null;
}

function isPerfScheme(s) {
  return !!s && (s.guid === SCHEME.ultimate || s.guid === SCHEME.high || PERF_NAME_RE.test(s.name || ''));
}

/* ------------------------------------------------------------ definitions */

function T(id, category, kind, title, desc, impact, recommended, o) {
  o = o || {};
  return Object.assign({
    id, category, kind, title, desc, impact, recommended,
    admin: !!o.admin, reboot: !!o.reboot, risk: o.risk || 'safe'
  }, o);
}

const DEFS = [
  T('power_plan', 'power', 'toggle', 'Схема питания «Максимальная производительность»',
    'Процессор не сбрасывает частоту в простое — меньше просадок и задержки.', ['fps', 'latency'], true,
    { custom: 'power' }),
  T('power_throttling', 'power', 'toggle', 'Отключить Power Throttling',
    'Windows перестаёт урезать частоту процессора для «фоновых» программ.', ['fps'], true, {
      admin: true,
      entries: [{ key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', name: 'PowerThrottlingOff', type: DW, on: 1, off: null }]
    }),
  T('game_mode', 'graphics', 'toggle', 'Игровой режим Windows',
    'Система отдаёт приоритет игре и не ставит обновления во время игры.', ['fps'], true, {
      entries: [
        { key: 'HKCU\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', type: DW, on: 1, off: 0, missingAs: 1 },
        { key: 'HKCU\\Software\\Microsoft\\GameBar', name: 'AllowAutoGameMode', type: DW, on: 1, off: 0, missingAs: 1 }
      ]
    }),
  T('game_dvr_off', 'graphics', 'toggle', 'Отключить фоновую запись Xbox Game Bar',
    'Game Bar больше не пишет видео в фоне — меньше нагрузка на видеокарту.', ['fps'], true, {
      entries: [
        { key: HKCU_GCS, name: 'GameDVR_Enabled', type: DW, on: 0, off: 1 },
        { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', name: 'AppCaptureEnabled', type: DW, on: 0, off: null }
      ]
    }),
  T('hags', 'graphics', 'toggle', 'Аппаратное планирование GPU',
    'Видеокарта сама управляет своей памятью — ниже задержка. Нужна перезагрузка.', ['fps', 'latency'], true, {
      admin: true, reboot: true,
      entries: [{ key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', name: 'HwSchMode', type: DW, on: 2, off: 1 }]
    }),
  T('fso_off', 'graphics', 'toggle', 'Отключить оптимизацию во весь экран',
    'Полноэкранные игры работают в «чистом» эксклюзивном режиме. Может мешать оверлеям и Alt+Tab.',
    ['latency'], false, {
      risk: 'moderate',
      entries: [
        { key: HKCU_GCS, name: 'GameDVR_FSEBehaviorMode', type: DW, on: 2, off: 0 },
        { key: HKCU_GCS, name: 'GameDVR_HonorUserFSEBehaviorMode', type: DW, on: 1, off: 0 },
        { key: HKCU_GCS, name: 'GameDVR_DXGIHonorFSEWindowsCompatible', type: DW, on: 1, off: 0 },
        { key: HKCU_GCS, name: 'GameDVR_FSEBehavior', type: DW, on: 2, off: null }
      ]
    }),
  T('games_priority', 'system', 'toggle', 'Приоритет игр для CPU и GPU',
    'Планировщик мультимедиа Windows (MMCSS) ставит игры выше остальных задач.', ['fps'], true, {
      admin: true,
      entries: [
        { key: MM + '\\Tasks\\Games', name: 'GPU Priority', type: DW, on: 8, off: 8 },
        { key: MM + '\\Tasks\\Games', name: 'Priority', type: DW, on: 6, off: 2 },
        { key: MM + '\\Tasks\\Games', name: 'Scheduling Category', type: SZ, on: 'High', off: 'Medium' },
        { key: MM + '\\Tasks\\Games', name: 'SFIO Priority', type: SZ, on: 'High', off: 'Normal' }
      ]
    }),
  T('system_responsiveness', 'system', 'toggle', 'Меньше ресурсов фоновым задачам',
    'Фоновым задачам остаётся 10% процессора вместо 20%.', ['fps', 'latency'], true, {
      admin: true,
      entries: [{ key: MM, name: 'SystemResponsiveness', type: DW, on: 10, off: 20 }]
    }),
  T('visual_effects', 'system', 'toggle', 'Упрощённые визуальные эффекты',
    'Отключает анимации и тени окон Windows — системе легче. Сглаживание шрифтов не трогаем.', ['fps'], true, {
      live: 'animation',
      note: 'Часть эффектов применится после выхода из Windows и повторного входа',
      entries: [
        { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', name: 'VisualFXSetting', type: DW, on: 2, off: 0 },
        { key: 'HKCU\\Control Panel\\Desktop\\WindowMetrics', name: 'MinAnimate', type: SZ, on: '0', off: '1' },
        { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'TaskbarAnimations', type: DW, on: 0, off: 1 },
        { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'ListviewAlphaSelect', type: DW, on: 0, off: 1 },
        { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'ListviewShadow', type: DW, on: 0, off: 1 }
      ]
    }),
  T('transparency_off', 'system', 'toggle', 'Отключить прозрачность',
    'Убирает прозрачность панели задач и меню «Пуск».', ['fps'], true, {
      entries: [{ key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'EnableTransparency', type: DW, on: 0, off: 1, missingAs: 1 }]
    }),
  T('background_apps_off', 'system', 'toggle', 'Запретить фоновые приложения',
    'Приложения из Microsoft Store не работают в фоне и не занимают память.', ['fps', 'ram'], true, {
      entries: [
        { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', name: 'GlobalUserDisabled', type: DW, on: 1, off: null },
        { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search', name: 'BackgroundAppGlobalToggle', type: DW, on: 0, off: null }
      ]
    }),
  T('mouse_accel_off', 'input', 'toggle', 'Отключить ускорение мыши',
    'Выключает «Повышенную точность указателя» — прицел двигается ровно за рукой.', ['latency'], true, {
      live: 'mouse',
      entries: [
        { key: 'HKCU\\Control Panel\\Mouse', name: 'MouseSpeed', type: SZ, on: '0', off: '1' },
        { key: 'HKCU\\Control Panel\\Mouse', name: 'MouseThreshold1', type: SZ, on: '0', off: '6' },
        { key: 'HKCU\\Control Panel\\Mouse', name: 'MouseThreshold2', type: SZ, on: '0', off: '10' }
      ]
    }),
  T('sticky_keys_off', 'input', 'toggle', 'Отключить залипание клавиш',
    'Пять нажатий Shift больше не выбросят окно посреди игры.', ['latency'], true, {
      live: 'sticky',
      entries: [{ key: 'HKCU\\Control Panel\\Accessibility\\StickyKeys', name: 'Flags', type: SZ, on: '506', off: '510' }]
    }),
  T('network_throttling', 'network', 'toggle', 'Снять ограничение сети',
    'Windows не режет сетевой трафик, пока играет звук или видео.', ['network', 'latency'], true, {
      admin: true,
      entries: [{ key: MM, name: 'NetworkThrottlingIndex', type: DW, on: 0xffffffff, off: 10 }]
    }),
  T('nagle_off', 'network', 'toggle', 'Отключить алгоритм Нейгла',
    'Пакеты уходят сразу, без склейки — пинг в онлайн-играх может стать ниже.', ['network', 'latency'], true, {
      admin: true,
      dynamic: 'nagle'
    }),
  T('clean_temp', 'cleanup', 'action', 'Очистить временные файлы',
    'Удаляет мусор из папок TEMP. Занятые и свежие файлы пропускаются.', ['storage'], true, { custom: 'clean' }),
  T('flush_dns', 'cleanup', 'action', 'Сбросить кэш DNS',
    'Помогает, когда сайты или игровые серверы вдруг перестали открываться.', ['network'], true, { custom: 'dns' }),
  T('restore_point', 'cleanup', 'action', 'Создать точку восстановления',
    'Снимок системы: если что-то пойдёт не так, Windows откатится к нему.', [], false, { admin: true, custom: 'restore' }),
  T('startup_apps', 'cleanup', 'link', 'Автозагрузка',
    'Отключи программы, которые зря запускаются вместе с Windows.', ['ram'], false, { url: 'ms-settings:startupapps' }),
  T('graphics_settings', 'cleanup', 'link', 'Настройки графики Windows',
    'Если в ноутбуке две видеокарты, выбери для игры «Высокую производительность».', ['fps'], false,
    { url: 'ms-settings:display-advancedgraphics' })
];

const BY_ID = Object.fromEntries(DEFS.map((d) => [d.id, d]));

function publicTweak(def, state) {
  return {
    id: def.id, category: def.category, title: def.title, desc: def.desc, impact: def.impact.slice(),
    kind: def.kind, state, recommended: def.recommended, requiresAdmin: def.admin,
    requiresReboot: def.reboot, risk: def.risk
  };
}

/* ----------------------------------------------------------------- engine */

function entryId(e) { return (e.key + '|' + e.name).toLowerCase(); }

function sameValue(type, a, b) {
  if (a === undefined || a === null) return false;
  if (type === DW || type === 'REG_QWORD') return Number(a) === Number(b);
  return String(a) === String(b);
}

/**
 * @param {object} deps {platform, reg, run, ps, isAdmin():Promise<bool>, isOtherUser():Promise<bool>, store,
 *                       openExternal(url), env, tempRoots?, now?}
 */
function createTweaks(deps) {
  const platform = deps.platform || process.platform;
  const reg = deps.reg || regDefault;
  const run = deps.run || runDefault.run;
  const ps = deps.ps || runDefault.ps;
  const store = deps.store;
  const env = deps.env || process.env;
  const isAdmin = deps.isAdmin || (async () => false);
  // Elevated as another account: HKCU is that account's hive, not the signed-in user's (see admin.isOtherUser).
  const isOtherUser = deps.isOtherUser || (async () => false);
  const now = deps.now || (() => Date.now());

  /** Per-call cache of whole registry keys: one reg.exe per key instead of one per value. */
  function makeCache() {
    const keys = new Map();
    return {
      seed(node) { keys.set(reg.normKey(node.key).toLowerCase(), Promise.resolve({ exists: true, values: node.values })); },
      key(k) {
        const id = reg.normKey(k).toLowerCase();
        if (!keys.has(id)) keys.set(id, Promise.resolve(reg.readKey(k)));
        return keys.get(id);
      },
      async value(k, name) {
        const kv = await this.key(k);
        const v = kv.values[String(name).toLowerCase()];
        return v ? { exists: true, type: v.type, value: v.value } : { exists: false };
      }
    };
  }

  async function nagleEntries(cache) {
    const tree = await reg.readTree(TCPIP_IF);
    const out = [];
    const base = reg.normKey(TCPIP_IF).toLowerCase();
    for (const node of tree.values()) {
      const k = node.key.toLowerCase();
      if (!k.startsWith(base + '\\') || k.slice(base.length + 1).includes('\\')) continue; // direct children only
      if (cache) cache.seed(node); // the /s listing already holds every value: no extra reg.exe per adapter
      const has = (n) => node.values[n] && String(node.values[n].value || '').replace(/\\0/g, '').trim() !== '';
      if (!has('dhcpipaddress') && !has('ipaddress')) continue;
      out.push(
        { key: node.key, name: 'TcpAckFrequency', type: DW, on: 1, off: null },
        { key: node.key, name: 'TCPNoDelay', type: DW, on: 1, off: null },
        { key: node.key, name: 'TcpDelAckTicks', type: DW, on: 0, off: null }
      );
    }
    return out;
  }

  async function entriesOf(def, cache) {
    if (def.dynamic === 'nagle') return nagleEntries(cache);
    return def.entries || [];
  }

  function needsAdminFor(def, entries) {
    return def.admin || entries.some((e) => reg.isMachineKey(e.key));
  }

  function userHive(entries) {
    return entries.some((e) => /^HKCU(\\|$)/.test(reg.normKey(e.key)));
  }

  async function registryState(def, cache) {
    const entries = await entriesOf(def, cache);
    if (!entries.length) return 'off';
    for (const e of entries) {
      const v = await cache.value(e.key, e.name);
      const cur = v.exists ? (v.type === e.type ? v.value : undefined) : e.missingAs;
      if (!sameValue(e.type, cur, e.on)) return 'off';
    }
    return 'on';
  }

  /* ---- power plan ---- */

  async function powercfg(args) { return run('powercfg.exe', args, { timeout: 20000 }); }

  async function activeScheme() {
    const r = await powercfg(['/getactivescheme']);
    return r.code === 0 ? parseActiveScheme(r.stdout) : null;
  }

  async function schemeList() {
    const r = await powercfg(['/list']);
    return r.code === 0 ? parseSchemeList(r.stdout) : [];
  }

  async function powerState() {
    const a = await activeScheme();
    if (!a) return 'unknown';
    const p = store.get('power');
    if (p && p.applied && p.applied === a.guid) return 'on';
    return isPerfScheme(a) ? 'on' : 'off';
  }

  async function powerEnable() {
    const active = await activeScheme();
    if (!active) throw new HostError('FAILED', 'Не удалось узнать текущую схему питания');
    const saved = store.get('power') || {};
    if (saved.applied === active.guid || isPerfScheme(active)) return { state: 'on' };
    const list = await schemeList();
    const exists = (g) => list.some((s) => s.guid === g);
    let created = null;
    let target = null;
    let denied = false;
    const setActive = async (g) => {
      const r = await powercfg(['/setactive', g]);
      if (r.code !== 0 && /denied|отказано/i.test(r.stderr + r.stdout)) denied = true;
      return r.code === 0;
    };
    const duplicate = async (src) => {
      const r = await powercfg(['-duplicatescheme', src]);
      if (r.code !== 0 && /denied|отказано/i.test(r.stderr + r.stdout)) denied = true;
      return r.code === 0 ? parseDuplicated(r.stdout, src) : null;
    };

    // 1) reuse the scheme GinN made earlier, 2) a fresh copy of Ultimate Performance,
    // 3) built-in High performance, 4) a copy of High performance.
    if (saved.created && exists(saved.created) && await setActive(saved.created)) target = saved.created;
    if (!target) {
      const g = await duplicate(SCHEME.ultimate);
      if (g) {
        if (await setActive(g)) { target = g; created = g; } else await powercfg(['-delete', g]);
      }
    }
    if (!target && exists(SCHEME.high) && await setActive(SCHEME.high)) target = SCHEME.high;
    if (!target) {
      const g = await duplicate(SCHEME.high);
      if (g) {
        if (await setActive(g)) { target = g; created = g; } else await powercfg(['-delete', g]);
      }
    }
    if (!target) {
      if (denied) throw new HostError('NEEDS_ADMIN', NEEDS_ADMIN_MSG);
      throw new HostError('FAILED', 'Windows не даёт включить эту схему питания. Так бывает на ноутбуках с Modern Standby — выбери «Максимальная производительность» в Параметрах → Питание.');
    }
    store.update((d) => {
      const prev = d.power && d.power.previous ? d.power.previous : active.guid;
      const keepCreated = created || (d.power && d.power.created && d.power.created === target ? d.power.created : null);
      // A scheme GinN created earlier but no longer uses is cleaned up below.
      d.power = { previous: prev, created: keepCreated, applied: target, previousName: (d.power && d.power.previousName) || active.name };
    });
    if (saved.created && saved.created !== target && exists(saved.created)) await powercfg(['-delete', saved.created]);
    return { state: 'on' };
  }

  async function powerDisable() {
    const saved = store.get('power');
    const list = await schemeList();
    const exists = (g) => list.some((s) => s.guid === g);
    let target = SCHEME.balanced;
    if (saved && saved.previous && saved.previous !== saved.applied && saved.previous !== saved.created && exists(saved.previous)) {
      target = saved.previous;
    }
    let r = await powercfg(['/setactive', target]);
    if (r.code !== 0 && target !== SCHEME.balanced) r = await powercfg(['/setactive', SCHEME.balanced]);
    if (r.code !== 0) {
      if (/denied|отказано/i.test(r.stderr + r.stdout)) throw new HostError('NEEDS_ADMIN', NEEDS_ADMIN_MSG);
      throw new HostError('FAILED', 'Не удалось вернуть схему питания');
    }
    if (saved && saved.created) await powercfg(['-delete', saved.created]);
    store.update((d) => { d.power = null; });
    return { state: await powerState() };
  }

  /* ---- live apply (SystemParametersInfo) ---- */

  const SPI_TYPE = "Add-Type -Namespace GinN -Name U -MemberDefinition '[DllImport(\"user32.dll\", SetLastError=true)] public static extern bool SystemParametersInfo(uint a, uint b, int[] c, uint d);';";

  async function liveApply(def, cache) {
    try {
      if (def.live === 'mouse') {
        const g = async (n, d) => {
          const v = await cache.value('HKCU\\Control Panel\\Mouse', n);
          const x = parseInt(v.exists ? v.value : d, 10);
          return Number.isFinite(x) ? x : parseInt(d, 10);
        };
        const t1 = await g('MouseThreshold1', '6');
        const t2 = await g('MouseThreshold2', '10');
        const sp = await g('MouseSpeed', '1');
        // SPI_SETMOUSE = 0x0004, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3
        await ps(SPI_TYPE + '[void][GinN.U]::SystemParametersInfo(4, 0, [int[]]@(' + t1 + ',' + t2 + ',' + sp + '), 3)', { timeout: 20000 });
      } else if (def.live === 'sticky') {
        const v = await cache.value('HKCU\\Control Panel\\Accessibility\\StickyKeys', 'Flags');
        const flags = parseInt(v.exists ? v.value : '510', 10) || 510;
        // SPI_SETSTICKYKEYS = 0x003B with STICKYKEYS {cbSize=8, dwFlags}
        await ps(SPI_TYPE + '[void][GinN.U]::SystemParametersInfo(0x3B, 8, [int[]]@(8,' + flags + '), 3)', { timeout: 20000 });
      } else if (def.live === 'animation') {
        const v = await cache.value('HKCU\\Control Panel\\Desktop\\WindowMetrics', 'MinAnimate');
        const on = v.exists ? (String(v.value) === '0' ? 0 : 1) : 1;
        // SPI_SETANIMATION = 0x0049 with ANIMATIONINFO {cbSize=8, iMinAnimate}
        await ps(SPI_TYPE + '[void][GinN.U]::SystemParametersInfo(0x49, 8, [int[]]@(8,' + on + '), 3)', { timeout: 20000 });
      }
    } catch (e) { /* the registry change still applies after the next sign-in */ }
  }

  /* ---- registry toggles ---- */

  async function snapshotEntries(entries) {
    const cache = makeCache();
    const out = {};
    for (const e of entries) {
      const v = await cache.value(e.key, e.name);
      out[entryId(e)] = v.exists
        ? { key: e.key, name: e.name, exists: true, type: v.type, value: v.value }
        : { key: e.key, name: e.name, exists: false };
    }
    return out;
  }

  async function writeEntry(e, value) {
    if (value === null || value === undefined) await reg.del(e.key, e.name);
    else await reg.set(e.key, e.name, e.type, value);
  }

  async function restoreBackup(id) {
    const b = (store.get('tweaks') || {})[id];
    if (!b || !b.entries) return false;
    for (const s of Object.values(b.entries)) {
      if (s.exists) await reg.set(s.key, s.name, s.type, s.value);
      else await reg.del(s.key, s.name);
    }
    store.update((d) => { delete d.tweaks[id]; });
    return true;
  }

  async function registryToggle(def, enable) {
    const entries = await entriesOf(def);
    if (needsAdminFor(def, entries) && !(await isAdmin())) throw new HostError('NEEDS_ADMIN', NEEDS_ADMIN_MSG);
    if (userHive(entries) && await isOtherUser()) throw new HostError('UNSUPPORTED', OTHER_USER_MSG);
    if (enable) {
      if (!entries.length) throw new HostError('NOT_FOUND', 'Не нашёл активных сетевых адаптеров');
      const snap = await snapshotEntries(entries);
      store.update((d) => {
        const b = d.tweaks[def.id] || (d.tweaks[def.id] = { entries: {} });
        for (const [k, v] of Object.entries(snap)) if (!b.entries[k]) b.entries[k] = v; // never overwrite
      });
      for (const e of entries) await writeEntry(e, e.on);
    } else {
      await restoreBackup(def.id);
      // Still on: it was on before GinN (no backup, or the backup was taken while it was on). Fall back to
      // Windows defaults, but keep the current values first so «Откатить» can bring the user's setting back.
      if (await registryState(def, makeCache()) === 'on') {
        const snap = await snapshotEntries(entries);
        store.update((d) => { d.tweaks[def.id] = { entries: snap }; });
        for (const e of entries) await writeEntry(e, e.off);
      }
    }
    const cache = makeCache();
    if (def.live) await liveApply(def, cache);
    return registryState(def, cache);
  }

  /* ---- cleanup actions ---- */

  function tempRoots(admin) {
    if (deps.tempRoots) return deps.tempRoots(admin);
    const roots = [env.TEMP, env.TMP, os.tmpdir()];
    if (admin && env.SystemRoot) roots.push(path.join(env.SystemRoot, 'Temp'));
    return roots;
  }

  /**
   * Only real, non-root folders called temp/tmp are ever cleaned (protects against TEMP=C:\).
   * Remote Desktop sessions get a numbered folder inside Temp (TEMP=...\Temp\2) — that counts too.
   */
  function safeRoot(p) {
    if (!p) return null;
    let real;
    try { real = fs.realpathSync(path.resolve(p)); } catch (e) { return null; }
    if (path.parse(real).root === real || path.parse(real).root === real + path.sep) return null;
    const isTempName = (n) => /^te?mp$/i.test(n);
    const base = path.basename(real);
    if (!isTempName(base) && !(/^\d{1,3}$/.test(base) && isTempName(path.basename(path.dirname(real))))) return null;
    try { if (!fs.statSync(real).isDirectory()) return null; } catch (e) { return null; }
    return real;
  }

  function inside(root, p) {
    const a = platform === 'win32' ? root.toLowerCase() : root;
    const b = platform === 'win32' ? p.toLowerCase() : p;
    return b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
  }

  /**
   * `dir` (built from a real root plus names lstat'ed as plain folders) must still resolve to itself.
   * Checked right before every readdir / unlink / rmdir: a folder swapped for a junction or symlink after
   * its lstat would otherwise send the deletes below it outside temp (with admin rights when elevated).
   */
  function unmoved(dir) {
    const fold = (p) => (platform === 'win32' ? p.toLowerCase() : p);
    try { return fold(fs.realpathSync(dir)) === fold(dir); } catch (e) { return false; }
  }

  /**
   * shallow: only files directly in the root. Used for Windows\Temp, where every user may create folders,
   * so nothing below it can be trusted to stay a real folder while an elevated GinN walks it.
   */
  async function cleanRoot(root, cutoff, acc, shallow) {
    async function walk(dir) {
      if (!unmoved(dir)) { acc.skipped++; return false; }
      let list;
      try { list = await fsp.readdir(dir); } catch (e) { acc.skipped++; return false; }
      let empty = true;
      for (const name of list) {
        const p = path.join(dir, name);
        if (!inside(root, p)) { empty = false; continue; }
        let st;
        try { st = await fsp.lstat(p); } catch (e) { empty = false; acc.skipped++; continue; }
        if (st.isSymbolicLink()) { empty = false; acc.skipped++; continue; } // never follow links/junctions
        if (st.isDirectory()) {
          if (shallow) { empty = false; continue; }
          const sub = await walk(p);
          if (sub && st.mtimeMs < cutoff && unmoved(dir)) {
            try { fs.rmdirSync(p); } catch (e) { empty = false; }
          } else empty = false;
        } else {
          if (st.mtimeMs >= cutoff) { empty = false; acc.skipped++; continue; }
          if (!unmoved(dir)) { empty = false; acc.skipped++; continue; }
          // Synchronous right after the check: no other work can run between the two.
          try { fs.unlinkSync(p); acc.freed += st.size; acc.removed++; } catch (e) { empty = false; acc.skipped++; }
        }
      }
      return empty;
    }
    await walk(root);
  }

  async function cleanTemp() {
    const admin = await isAdmin();
    const seen = new Set();
    const roots = [];
    for (const r of tempRoots(admin)) {
      const s = safeRoot(r);
      if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); roots.push(s); }
    }
    if (!roots.length) throw new HostError('NOT_FOUND', 'Не нашёл папку временных файлов');
    const shared = env.SystemRoot ? safeRoot(path.join(env.SystemRoot, 'Temp')) : null;
    const acc = { freed: 0, removed: 0, skipped: 0 };
    const cutoff = now() - 60 * 60 * 1000; // files touched in the last hour may still be in use
    for (const r of roots) await cleanRoot(r, cutoff, acc, !!shared && r.toLowerCase() === shared.toLowerCase());
    const mb = Math.round(acc.freed / (1024 * 1024));
    let message = acc.removed ? 'Освобождено ' + mb + ' МБ' : 'Удалять нечего — временные файлы уже чистые';
    if (acc.skipped) message += '. Пропущено занятых или свежих: ' + acc.skipped;
    if (!admin && platform === 'win32') message += '. Папку Windows\\Temp чищу только с правами администратора';
    return { state: 'off', message, freedMB: mb };
  }

  async function flushDns() {
    const r = await run('ipconfig.exe', ['/flushdns'], { timeout: 15000 });
    if (r.code !== 0) throw new HostError('FAILED', 'Не удалось сбросить кэш DNS', r.stderr || r.stdout);
    return { state: 'off', message: 'Кэш DNS сброшен' };
  }

  async function restorePoint() {
    if (!(await isAdmin())) throw new HostError('NEEDS_ADMIN', NEEDS_ADMIN_MSG);
    const r = await ps("$w=$null; try { Checkpoint-Computer -Description 'GinN' -RestorePointType MODIFY_SETTINGS " +
      "-ErrorAction Stop -WarningVariable w -WarningAction SilentlyContinue; if ($w) { Write-Output 'GINN_SKIPPED' } " +
      "else { Write-Output 'GINN_OK' } } catch { Write-Output ('GINN_ERR:' + $_.Exception.Message) }", { timeout: 300000 });
    const out = r.stdout || '';
    if (/GINN_OK/.test(out)) return { state: 'off', message: 'Точка восстановления создана' };
    if (/GINN_SKIPPED/.test(out)) {
      return { state: 'off', message: 'Windows создаёт не больше одной точки в сутки — сегодняшняя точка уже есть' };
    }
    if (/disabled|отключ|0x80042306|service cannot be started/i.test(out)) {
      throw new HostError('FAILED', 'Защита системы выключена. Включи её: Панель управления → Система → Защита системы');
    }
    throw new HostError('FAILED', 'Не удалось создать точку восстановления', out + r.stderr);
  }

  /* ---- public ---- */

  async function list() {
    if (platform !== 'win32') return DEFS.map((d) => publicTweak(d, 'unknown'));
    const cache = makeCache();
    const other = isOtherUser().catch(() => false);
    return Promise.all(DEFS.map(async (d) => {
      let state = 'unknown';
      try {
        if (d.kind === 'action') state = 'off';
        else if (d.kind === 'link') state = 'unknown';
        else if (d.custom === 'power') state = await powerState();
        else if (userHive(d.entries || []) && await other) state = 'unknown'; // another account's settings
        else state = await registryState(d, cache);
      } catch (e) { state = 'unknown'; }
      return publicTweak(d, state);
    }));
  }

  async function apply(args) {
    const a = args || {};
    const def = BY_ID[a.id];
    if (!def) throw new HostError('NOT_FOUND', 'Такой настройки нет');
    if (platform !== 'win32') throw unsupported();
    const enable = a.enable !== false;
    let res;
    if (def.kind === 'link') {
      await deps.openExternal(def.url);
      return { id: def.id, state: 'unknown', message: 'Открыты настройки' };
    }
    if (def.custom === 'clean') res = await cleanTemp();
    else if (def.custom === 'dns') res = await flushDns();
    else if (def.custom === 'restore') res = await restorePoint();
    else if (def.custom === 'power') res = enable ? await powerEnable() : await powerDisable();
    else res = { state: await registryToggle(def, enable) };
    const out = { id: def.id, state: res.state };
    if (res.message) out.message = res.message;
    else if (def.note && def.kind === 'toggle') out.message = def.note;
    if (def.reboot && def.kind === 'toggle') {
      out.needsReboot = true;
      out.message = 'Изменение заработает после перезагрузки';
    }
    return out;
  }

  /** Undo everything GinN changed: every tweak backup + the power plan. */
  async function revertAll() {
    const reverted = [];
    const failed = [];
    if (platform !== 'win32') return { reverted, failed };
    const tw = store.get('tweaks') || {};
    for (const id of Object.keys(tw)) {
      const def = BY_ID[id];
      try {
        const entries = def ? await entriesOf(def) : [];
        const machine = Object.values(tw[id].entries || {}).some((s) => reg.isMachineKey(s.key)) ||
          (def && needsAdminFor(def, entries));
        if (machine && !(await isAdmin())) throw new HostError('NEEDS_ADMIN', NEEDS_ADMIN_MSG);
        await restoreBackup(id);
        if (def && def.live) await liveApply(def, makeCache());
        reverted.push(id);
      } catch (e) {
        failed.push({ id, error: e.message || 'Ошибка' });
      }
    }
    if (store.get('power')) {
      try { await powerDisable(); reverted.push('power_plan'); } catch (e) { failed.push({ id: 'power_plan', error: e.message }); }
    }
    return { reverted, failed };
  }

  return { list, apply, revertAll, defs: DEFS };
}

module.exports = {
  createTweaks, DEFS, SCHEME, parseActiveScheme, parseSchemeList, parseDuplicated, isPerfScheme
};
