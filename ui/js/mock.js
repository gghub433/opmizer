/* GinN — mock host for the browser (dev, tests, demo). Loads AFTER host.js; used only when
 * there is no native bridge. Everything here is fake data and says so: info().demo === true.
 *   ?platform=android (default) | ?platform=windows      ?admin=1  -> windows mock is elevated
 * Stateful: tweak states, admin flag and game profiles live in sessionStorage (per tab).
 * AI: the Claude key + model live in localStorage 'ginn.mock.ai' (transport 'page' — the page calls Claude itself).
 *   ?aidemo=1 -> transport 'mock': aiMessage answers with a canned demo Message built by GinN.ai.localPlan. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  /* ---------------------------------------------------------------- setup */

  function query(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&#]*)').exec((window.location && window.location.search) || '');
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function ssGet(key) { try { return window.sessionStorage.getItem(key); } catch (e) { return null; } }
  function ssSet(key, v) { try { window.sessionStorage.setItem(key, v); } catch (e) { /* blocked storage */ } }

  var flavour = query('platform') === 'windows' ? 'windows' : 'android';
  var ADMIN_KEY = 'ginn.mock.admin';
  var STATE_KEY = 'ginn.mock.state.' + flavour;
  var startedAt = Date.now();

  function isAdmin() { return flavour === 'windows' && (query('admin') === '1' || ssGet(ADMIN_KEY) === '1'); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function round1(v) { return Math.round(v * 10) / 10; }
  function mbText(n) { return G.fmt ? G.fmt.mb(n) : Math.round(n) + ' МБ'; }

  /** Smooth random walk between min and max; spikes are rarer when `skew` > 1. */
  function walker(min, max, start, jitter, skew) {
    var v = start, target = start;
    return function () {
      if (Math.random() < 0.08) target = min + (max - min) * Math.pow(Math.random(), skew || 1);
      v = clamp(v + (target - v) * 0.18 + rnd(-jitter, jitter), min, max);
      return v;
    };
  }

  /* --------------------------------------------------------- tweak lists */

  function tw(id, category, kind, title, desc, impact, recommended, o) {
    o = o || {};
    return {
      id: id, category: category, title: title, desc: desc, impact: impact, kind: kind,
      state: 'off', recommended: recommended, requiresAdmin: !!o.admin, requiresReboot: !!o.reboot,
      risk: o.risk || 'safe'
    };
  }

  var ANDROID_TWEAKS = [
    tw('boost_ram', 'system', 'action', 'Ускорение — очистка ОЗУ',
      'Закрывает фоновые приложения и освобождает оперативную память перед игрой.', ['fps', 'ram'], true),
    tw('dnd_gaming', 'system', 'toggle', 'Не беспокоить во время игры',
      'Уведомления не будут всплывать поверх игры и отвлекать в важный момент.', ['latency'], false),
    tw('battery_saver', 'power', 'link', 'Выключить экономию заряда',
      'Экономия заряда занижает частоты процессора. Откроем настройки — выключи её на время игры.', ['fps'], true),
    tw('refresh_rate', 'graphics', 'link', 'Максимальная частота экрана',
      'Включи самую высокую частоту обновления экрана — игры станут плавнее.', ['fps', 'latency'], true),
    tw('animations', 'system', 'link', 'Быстрые анимации',
      'В режиме разработчика поставь три «Анимации» на 0,5x или выкл. — телефон станет отзывчивее.', ['latency'], true),
    tw('storage_cleanup', 'cleanup', 'link', 'Очистка памяти',
      'Когда память почти заполнена, телефон тормозит. Откроем хранилище — удали лишнее.', ['storage'], true)
  ];
  var ANDROID_INITIAL = {
    boost_ram: 'off', dnd_gaming: 'off', battery_saver: 'on',
    refresh_rate: 'off', animations: 'off', storage_cleanup: 'on'
  };

  var WINDOWS_TWEAKS = [
    tw('power_plan', 'power', 'toggle', 'Схема питания «Максимальная производительность»',
      'Процессор не сбрасывает частоту в простое — меньше просадок и задержки.', ['fps', 'latency'], true),
    tw('power_throttling', 'power', 'toggle', 'Отключить Power Throttling',
      'Windows перестаёт урезать частоту процессора для «фоновых» программ.', ['fps'], true, { admin: true }),
    tw('game_mode', 'graphics', 'toggle', 'Игровой режим Windows',
      'Система отдаёт приоритет игре и не ставит обновления во время игры.', ['fps'], true),
    tw('game_dvr_off', 'graphics', 'toggle', 'Отключить фоновую запись Xbox Game Bar',
      'Game Bar больше не пишет видео в фоне — меньше нагрузка на видеокарту.', ['fps'], true),
    tw('hags', 'graphics', 'toggle', 'Аппаратное планирование GPU',
      'Видеокарта сама управляет своей памятью — ниже задержка. Нужна перезагрузка.', ['fps', 'latency'], true,
      { admin: true, reboot: true }),
    tw('fso_off', 'graphics', 'toggle', 'Отключить оптимизацию во весь экран',
      'Полноэкранные игры работают в «чистом» эксклюзивном режиме. Может мешать оверлеям и Alt+Tab.',
      ['latency'], false, { risk: 'moderate' }),
    tw('games_priority', 'system', 'toggle', 'Приоритет игр для CPU и GPU',
      'Планировщик мультимедиа Windows (MMCSS) ставит игры выше остальных задач.', ['fps'], true, { admin: true }),
    tw('system_responsiveness', 'system', 'toggle', 'Меньше ресурсов фоновым задачам',
      'Фоновым задачам остаётся 10% процессора вместо 20%.', ['fps', 'latency'], true, { admin: true }),
    tw('visual_effects', 'system', 'toggle', 'Упрощённые визуальные эффекты',
      'Отключает анимации и тени окон Windows — системе легче.', ['fps'], true),
    tw('transparency_off', 'system', 'toggle', 'Отключить прозрачность',
      'Убирает прозрачность панели задач и меню «Пуск».', ['fps'], true),
    tw('background_apps_off', 'system', 'toggle', 'Запретить фоновые приложения',
      'Приложения из Microsoft Store не работают в фоне и не занимают память.', ['fps', 'ram'], true),
    tw('mouse_accel_off', 'input', 'toggle', 'Отключить ускорение мыши',
      'Выключает «Повышенную точность указателя» — прицел двигается ровно за рукой.', ['latency'], true),
    tw('sticky_keys_off', 'input', 'toggle', 'Отключить залипание клавиш',
      'Пять нажатий Shift больше не выбросят окно посреди игры.', ['latency'], true),
    tw('network_throttling', 'network', 'toggle', 'Снять ограничение сети',
      'Windows не режет сетевой трафик, пока играет звук или видео.', ['network', 'latency'], true, { admin: true }),
    tw('nagle_off', 'network', 'toggle', 'Отключить алгоритм Нейгла',
      'Пакеты уходят сразу, без склейки — пинг в онлайн-играх может стать ниже.', ['network', 'latency'], true,
      { admin: true }),
    tw('clean_temp', 'cleanup', 'action', 'Очистить временные файлы',
      'Удаляет мусор из папок TEMP. Занятые файлы пропускаются.', ['storage'], true),
    tw('flush_dns', 'cleanup', 'action', 'Сбросить кэш DNS',
      'Помогает, когда сайты или игровые серверы вдруг перестали открываться.', ['network'], true),
    tw('restore_point', 'cleanup', 'action', 'Создать точку восстановления',
      'Снимок системы: если что-то пойдёт не так, Windows откатится к нему.', [], false, { admin: true }),
    tw('startup_apps', 'cleanup', 'link', 'Автозагрузка',
      'Отключи программы, которые зря запускаются вместе с Windows.', ['ram'], false),
    tw('graphics_settings', 'cleanup', 'link', 'Настройки графики Windows',
      'Если в ноутбуке две видеокарты, выбери для игры «Высокую производительность».', ['fps'], false)
  ];
  var WINDOWS_INITIAL = {
    power_plan: 'off', power_throttling: 'off', game_mode: 'on', game_dvr_off: 'off', hags: 'on', fso_off: 'off',
    games_priority: 'off', system_responsiveness: 'off', visual_effects: 'off', transparency_off: 'off',
    background_apps_off: 'off', mouse_accel_off: 'off', sticky_keys_off: 'off', network_throttling: 'off',
    nagle_off: 'off', clean_temp: 'off', flush_dns: 'off', restore_point: 'off',
    startup_apps: 'unknown', graphics_settings: 'unknown'
  };

  var TWEAKS = flavour === 'windows' ? WINDOWS_TWEAKS : ANDROID_TWEAKS;
  var INITIAL = flavour === 'windows' ? WINDOWS_INITIAL : ANDROID_INITIAL;
  function findTweak(id) {
    for (var i = 0; i < TWEAKS.length; i++) if (TWEAKS[i].id === id) return TWEAKS[i];
    return null;
  }

  /* ---------------------------------------------------------------- games */

  var ANDROID_GAMES = [
    { id: 'com.mojang.minecraftpe', name: 'Minecraft', catalogId: 'minecraft', icon: null, source: 'android' },
    { id: 'com.tencent.ig', name: 'PUBG Mobile', catalogId: 'pubgm', icon: null, source: 'android' },
    { id: 'com.supercell.brawlstars', name: 'Brawl Stars', catalogId: 'brawlstars', icon: null, source: 'android' },
    { id: 'com.roblox.client', name: 'Roblox', catalogId: 'roblox', icon: null, source: 'android' },
    { id: 'com.miHoYo.GenshinImpact', name: 'Genshin Impact', catalogId: 'genshin', icon: null, source: 'android' }
  ];
  var WINDOWS_GAMES = [
    { id: 'steam:730', name: 'Counter-Strike 2', catalogId: 'cs2', icon: null, source: 'steam' },
    { id: 'minecraft-java', name: 'Minecraft: Java Edition', catalogId: 'minecraft', icon: null, source: 'minecraft' },
    { id: 'epic:Fortnite', name: 'Fortnite', catalogId: 'fortnite', icon: null, source: 'epic' },
    { id: 'steam:570', name: 'Dota 2', catalogId: 'dota2', icon: null, source: 'steam' },
    { id: 'roblox', name: 'Roblox', catalogId: 'roblox', icon: null, source: 'roblox' }
  ];
  var GAMES = flavour === 'windows' ? WINDOWS_GAMES : ANDROID_GAMES;

  var USER_DIR = 'C:\\Users\\Player';
  var PROFILE_FILES = {
    minecraft: [USER_DIR + '\\AppData\\Roaming\\.minecraft\\options.txt'],
    cs2: ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\autoexec.cfg',
      'C:\\Program Files (x86)\\Steam\\userdata\\182736455\\730\\local\\cfg\\cs2_video.txt'],
    fortnite: [USER_DIR + '\\AppData\\Local\\FortniteGame\\Saved\\Config\\WindowsClient\\GameUserSettings.ini']
  };

  /* ---------------------------------------------------------------- state */

  var st = {
    tweaks: Object.assign({}, INITIAL),
    changed: {},          // id -> state before GinN touched it (for revertAll)
    pendingLink: {},      // link opened; the "user" fixes it in system settings
    profiles: {},         // gameId -> {preset, fps}
    dndAccess: false,
    devOptions: false
  };
  (function load() {
    var raw = ssGet(STATE_KEY);
    if (!raw) return;
    try {
      var saved = JSON.parse(raw);
      ['tweaks', 'changed', 'pendingLink', 'profiles'].forEach(function (k) {
        if (saved[k] && typeof saved[k] === 'object') st[k] = Object.assign(st[k], saved[k]);
      });
      st.dndAccess = !!saved.dndAccess;
      st.devOptions = !!saved.devOptions;
    } catch (e) { /* corrupted state: start fresh */ }
  })();
  function save() { ssSet(STATE_KEY, JSON.stringify(st)); }

  function settleLinks() {
    Object.keys(st.pendingLink).forEach(function (id) { st.tweaks[id] = 'on'; });
    if (Object.keys(st.pendingLink).length) { st.pendingLink = {}; save(); }
  }

  /* ---- live numbers */
  var A = { totalMB: 7680, baseAvail: 3100, avail: 3100 };
  var W = { totalMB: 16384 };
  var aMHz = walker(600, 2750, 1800, 120, 1);
  var aTemp = walker(30.2, 37.8, 31.5, 0.08, 1.3);
  var wLoad = walker(3, 68, 12, 2.5, 2.4);
  var wGpu = walker(1, 52, 6, 2, 2.2);
  var wRam = walker(38, 58, 44, 0.6, 1);
  var wTempNoise = walker(-2, 2, 0, 0.3, 1);

  function androidAvail() {
    A.avail = clamp(A.avail + (A.baseAvail - A.avail) * 0.02 + rnd(-35, 35), 1500, A.totalMB * 0.8);
    return Math.round(A.avail);
  }
  function batteryLevel() { return Math.max(5, 78 - Math.floor((Date.now() - startedAt) / 150000)); }

  /* ------------------------------------------------------------- handlers */

  function fail(code, error) { var e = new Error(error); e.code = code; throw e; }

  function webglGpu() {
    try { return G.devices && G.devices.gpuFromWebGL ? G.devices.gpuFromWebGL() : null; } catch (e) { return null; }
  }

  var H = {};

  H.info = function () {
    var info = {
      platform: flavour, appVersion: G.version || '1.0.0', demo: true,
      capabilities: flavour === 'windows'
        ? ['tweaks', 'games.detect', 'games.launch', 'games.profile', 'saveFile', 'admin', 'ai']
        : ['tweaks', 'games.detect', 'games.launch', 'boost', 'dnd', 'saveFile', 'ai']
    };
    if (flavour === 'windows') info.isAdmin = isAdmin();
    return info;
  };

  H.hardware = function () {
    settleLinks();
    if (flavour === 'windows') {
      return {
        device: { name: 'MSI MAG B550 TOMAHAWK', manufacturer: 'MSI', model: 'MAG B550 TOMAHAWK (MS-7C91)', type: 'desktop' },
        os: { name: 'Windows 11 Pro', version: '23H2', build: '22631.4317' },
        cpu: { name: 'AMD Ryzen 5 5600 6-Core Processor', vendor: 'AMD', cores: 6, threads: 12, maxMHz: 4400, arch: 'x64' },
        gpu: { name: 'NVIDIA GeForce RTX 3060', vramMB: 12288 },
        ram: { totalMB: W.totalMB, availMB: Math.round(W.totalMB * (1 - wRam() / 100)) },
        storage: { totalGB: 931.5, freeGB: 402.7, type: 'SSD' },
        display: { width: 2560, height: 1440, refreshHz: 165, maxRefreshHz: 165 },
        battery: null
      };
    }
    return {
      device: { name: 'Samsung Galaxy A55', manufacturer: 'Samsung', model: 'SM-A556B', type: 'phone' },
      os: { name: 'Android 14', version: '14', build: 'UP1A.231005.007' },
      cpu: { name: 's5e8845', vendor: 'Samsung', cores: 8, threads: 8, maxMHz: 2750, arch: 'arm64-v8a' },
      // Real Android host sends null and the UI asks WebGL; the mock fills a name only if WebGL knows nothing.
      gpu: { name: webglGpu() ? null : 'Xclipse 530', vramMB: null },
      ram: { totalMB: A.totalMB, availMB: androidAvail() },
      storage: { totalGB: 238.4, freeGB: 91.2, type: 'UFS' },
      display: { width: 1080, height: 2340, refreshHz: st.tweaks.refresh_rate === 'on' ? 120 : 60, maxRefreshHz: 120 },
      battery: { present: true, level: batteryLevel(), charging: false, tempC: round1(aTemp()) }
    };
  };

  H.stats = function () {
    if (flavour === 'windows') {
      var load = wLoad();
      var ram = wRam();
      var boost = st.tweaks.power_plan === 'on' ? 150 : 0;
      return {
        cpuLoad: Math.round(load),
        cpuMHz: Math.round(clamp(3550 + boost + load * 8.5 + rnd(-60, 60), 3400, 4400)),
        ramUsedPct: Math.round(ram),
        ramAvailMB: Math.round(W.totalMB * (1 - ram / 100)),
        tempC: Math.round(39 + load * 0.42 + wTempNoise()),
        tempSource: 'cpu', batteryLevel: null, thermal: null,
        gpuLoad: Math.round(wGpu())
      };
    }
    var avail = androidAvail();
    var t = round1(aTemp());
    return {
      cpuLoad: null,
      cpuMHz: Math.round(aMHz() / 10) * 10,
      ramUsedPct: Math.round((1 - avail / A.totalMB) * 100),
      ramAvailMB: avail,
      tempC: t, tempSource: 'battery', batteryLevel: batteryLevel(),
      thermal: t >= 36.5 ? 'light' : 'none',
      gpuLoad: null
    };
  };

  H.tweaks = function () {
    settleLinks();
    return TWEAKS.map(function (t) {
      var c = Object.assign({}, t);
      c.impact = t.impact.slice();
      c.state = st.tweaks[t.id] || 'unknown';
      return c;
    });
  };

  function freeRam() {
    var before = A.avail;
    var freed = Math.round(rnd(250, 650));
    A.avail = Math.min(before + freed, A.totalMB * 0.8);
    return { freed: Math.round(A.avail - before), avail: Math.round(A.avail) };
  }

  var ANDROID_LINK_TARGET = { battery_saver: 'battery_saver', refresh_rate: 'display', animations: 'developer', storage_cleanup: 'storage' };

  function scheduleResume() {
    setTimeout(function () {
      if (G.bus) G.bus.emit('host:resume', { type: 'resume', source: 'mock' });
    }, Math.round(1500 * mock.latencyScale));
  }

  H.applyTweak = function (args) {
    var t = findTweak(args.id);
    if (!t) fail('NOT_FOUND', 'Такой оптимизации нет: ' + args.id);
    var enable = args.enable !== false;
    var id = t.id;
    var prev = st.tweaks[id];

    if (t.requiresAdmin && !isAdmin()) {
      fail('NEEDS_ADMIN', 'Нужны права администратора. Перезапусти GinN от имени администратора.');
    }

    if (t.kind === 'link') {
      if (flavour === 'android' && id === 'animations' && !st.devOptions) {
        st.devOptions = true; // the "user" taps the build number in the opened screen
        save();
        return { id: id, state: prev, message: 'Нажми 7 раз на «Номер сборки», чтобы включить режим разработчика' };
      }
      if (flavour === 'android' && prev !== 'on') { st.pendingLink[id] = true; save(); scheduleResume(); }
      return { id: id, state: prev, message: 'Открыты настройки' };
    }

    if (t.kind === 'action') {
      var msg;
      if (id === 'boost_ram') {
        var r = freeRam();
        msg = 'Свободно ' + mbText(r.avail) + ' ОЗУ (+' + mbText(r.freed) + ')';
      } else if (id === 'clean_temp') {
        var freed = Math.round(isAdmin() ? rnd(700, 2600) : rnd(250, 1300));
        var skipped = Math.round(rnd(6, 48));
        msg = 'Освобождено ' + mbText(freed) + '. Пропущено занятых файлов: ' + skipped;
        if (!isAdmin()) msg += '. Без прав администратора очищена только папка TEMP пользователя';
      } else if (id === 'flush_dns') {
        msg = 'Кэш DNS сброшен';
      } else if (id === 'restore_point') {
        msg = 'Точка восстановления «GinN» создана';
      } else {
        msg = 'Готово';
      }
      st.tweaks[id] = 'on'; // "done in this session"
      save();
      return { id: id, state: 'on', message: msg };
    }

    // toggle
    if (flavour === 'android' && id === 'dnd_gaming' && enable && !st.dndAccess) {
      fail('NEEDS_PERMISSION', 'Разреши GinN управлять режимом «Не беспокоить» — откроем нужный экран.');
    }
    var next = enable ? 'on' : 'off';
    if (!(id in st.changed) && prev !== next) st.changed[id] = prev;
    st.tweaks[id] = next;
    if (st.changed[id] === next) delete st.changed[id];
    save();

    var res = { id: id, state: next };
    if (t.requiresReboot && prev !== next) {
      res.needsReboot = true;
      res.message = 'Перезагрузи компьютер, чтобы изменение заработало';
    } else if (id === 'power_plan') {
      res.message = enable ? 'Включена схема «Максимальная производительность»' : 'Возвращена прежняя схема питания';
    } else if (id === 'dnd_gaming') {
      res.message = enable ? 'Режим «Не беспокоить» включён' : 'Уведомления снова включены';
    } else {
      res.message = enable ? 'Включено' : 'Выключено';
    }
    return res;
  };

  H.revertAll = function () {
    var reverted = [], failed = [];
    Object.keys(st.changed).forEach(function (id) {
      var t = findTweak(id);
      if (t && t.requiresAdmin && !isAdmin()) {
        failed.push({ id: id, error: 'Нужны права администратора' });
        return;
      }
      st.tweaks[id] = st.changed[id];
      delete st.changed[id];
      reverted.push(id);
    });
    Object.keys(st.profiles).forEach(function (gameId) {
      delete st.profiles[gameId];
      reverted.push('game:' + gameId);
    });
    save();
    return { reverted: reverted, failed: failed };
  };

  H.games = function (args) {
    var known = Array.isArray(args.knownPackages) && args.knownPackages.length ? args.knownPackages : null;
    return GAMES.filter(function (g) {
      return flavour !== 'android' || !known || known.indexOf(g.id) >= 0;
    }).map(function (g) { return Object.assign({}, g); });
  };

  function installed(id) {
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
    return null;
  }

  H.launchGame = function (args) {
    var g = installed(args.id);
    if (!g) fail('NOT_FOUND', 'Игра не найдена — возможно, её удалили');
    if (flavour === 'android' && args.boost) {
      var r = freeRam();
      return { message: 'Освободил ' + mbText(r.freed) + ' ОЗУ. Запускаю ' + g.name + '…' };
    }
    return { message: 'Запускаю ' + g.name + '…' };
  };

  function profileAllowed(gameId) {
    if (G.games && G.games.get) {
      var c = G.games.get(gameId);
      return !!(c && c.pc && c.pc.profile);
    }
    return !!PROFILE_FILES[gameId];
  }
  function installedByCatalog(gameId) {
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].catalogId === gameId) return GAMES[i];
    return null;
  }

  H.applyGameProfile = function (args) {
    if (flavour === 'android') {
      fail('UNSUPPORTED', 'Android не даёт приложениям менять настройки других игр. Выставь их по списку.');
    }
    var gameId = args.gameId;
    if (!profileAllowed(gameId) || !PROFILE_FILES[gameId]) {
      fail('UNSUPPORTED', 'Для этой игры GinN пока не умеет менять настройки сам — выставь их по списку.');
    }
    var g = installedByCatalog(gameId);
    if (!g) fail('NOT_FOUND', 'Игра не найдена на этом компьютере');
    var fps = Math.round(Number(args.fps));
    if (!(fps >= 30)) fail('FAILED', 'Неверный лимит FPS');
    var preset = args.preset === 'balanced' ? 'balanced' : 'potato';
    var written = PROFILE_FILES[gameId].slice();
    if (gameId === 'minecraft' && args.grayTextures) {
      written.push(USER_DIR + '\\AppData\\Roaming\\.minecraft\\resourcepacks\\GinN Gray.zip');
    }
    st.profiles[gameId] = { preset: preset, fps: fps };
    save();
    var msg = 'Готово: ' + (preset === 'potato' ? '«Картошка»' : '«Баланс»') + ', лимит ' + fps + ' FPS. ';
    if (gameId === 'minecraft' && args.grayTextures) msg += 'Серые текстуры включены. ';
    msg += 'Если игра открыта — перезапусти её.';
    return { written: written, message: msg };
  };

  H.revertGameProfile = function (args) {
    if (flavour === 'android') fail('UNSUPPORTED', 'На Android GinN не меняет настройки игр — возвращать нечего.');
    if (!st.profiles[args.gameId]) fail('NOT_FOUND', 'Резервной копии нет — GinN ещё не менял настройки этой игры');
    delete st.profiles[args.gameId];
    save();
    return { message: 'Настройки игры возвращены из резервной копии' };
  };

  H.saveFile = function (args) {
    var name = String(args.name || '').replace(/[\\/:*?"<>|]+/g, '_');
    if (!name || typeof args.base64 !== 'string') fail('FAILED', 'Нечего сохранять');
    if (typeof document === 'undefined' || !document.createElement || typeof Blob === 'undefined') {
      fail('UNSUPPORTED', 'Этот браузер не умеет скачивать файлы');
    }
    var bin = window.atob(args.base64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var blob = new Blob([bytes], { type: args.mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(function () {
      try { a.parentNode && a.parentNode.removeChild(a); URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    }, 1500);
    return { path: 'Загрузки/' + name };
  };

  H.copyText = function (args) {
    var text = String(args.text == null ? '' : args.text);
    function legacy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    var nav = window.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      return nav.clipboard.writeText(text).then(function () { return {}; }, function () {
        if (legacy()) return {};
        fail('FAILED', 'Не удалось скопировать — браузер не дал доступ к буферу обмена');
      });
    }
    if (legacy()) return {};
    fail('FAILED', 'Не удалось скопировать — браузер не дал доступ к буферу обмена');
  };

  var SETTINGS_TARGETS = flavour === 'windows'
    ? ['graphics', 'gamemode', 'power', 'startup', 'storage']
    : ['developer', 'battery_saver', 'display', 'dnd_access', 'storage'];

  H.openSettings = function (args) {
    var target = String(args.target || '');
    var ok = SETTINGS_TARGETS.indexOf(target) >= 0 || (flavour === 'android' && /^app_details:[\w.]+$/.test(target));
    if (!ok) fail('UNSUPPORTED', 'Такого раздела настроек нет');
    if (target === 'dnd_access') { st.dndAccess = true; save(); } // the "user" grants access
    return {};
  };

  H.relaunchAsAdmin = function () {
    if (flavour !== 'windows') fail('UNSUPPORTED', 'Права администратора бывают только на Windows');
    ssSet(ADMIN_KEY, '1');
    setTimeout(function () { try { window.location.reload(); } catch (e) { /* ignore */ } }, 400);
    return {};
  };

  H.openExternal = function (args) {
    var url = String(args.url || '');
    if (!/^https?:\/\//i.test(url)) fail('FAILED', 'Такую ссылку открыть нельзя');
    try { if (window.open) window.open(url, '_blank', 'noopener'); } catch (e) { /* popup blocked */ }
    return {};
  };

  /* ------------------------------------------------------------------- AI */

  var AI_KEY = 'ginn.mock.ai';
  var aiDemo = query('aidemo') === '1';
  var AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

  function aiLoad() {
    try {
      var o = JSON.parse(window.localStorage.getItem(AI_KEY) || '{}');
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }
  function aiSave(o) {
    try { window.localStorage.setItem(AI_KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }
  function aiModels() {
    return G.ai && G.ai.MODELS ? G.ai.MODELS.map(function (m) { return m.id; }) : AI_MODELS;
  }
  function aiDefaultModel() { return (G.ai && G.ai.DEFAULT_MODEL) || AI_MODELS[0]; }

  H.aiStatus = function () {
    var s = aiLoad();
    return {
      configured: aiDemo || !!s.key,
      model: aiModels().indexOf(s.model) >= 0 ? s.model : aiDefaultModel(),
      transport: aiDemo ? 'mock' : 'page'
    };
  };

  H.aiConfigure = function (args) {
    var s = aiLoad();
    if (args.key != null) {
      var key = String(args.key).trim();
      if (!key) fail('AI_BAD_KEY', 'Вставь ключ Claude API.');
      s.key = key;
    }
    if (args.model != null) {
      if (aiModels().indexOf(args.model) < 0) fail('AI_BAD_REQUEST', 'Такой модели нет.');
      s.model = args.model;
    }
    if (!aiSave(s)) fail('FAILED', 'Браузер не дал сохранить настройки ИИ.');
    return H.aiStatus();
  };

  H.aiClear = function () {
    var s = aiLoad();
    delete s.key;
    aiSave(s);
    return H.aiStatus();
  };

  H.aiKey = function () {
    var s = aiLoad();
    if (!s.key) fail('AI_NO_KEY', 'Добавь ключ Claude API, чтобы включить ИИ.');
    return { key: s.key };
  };

  function demoId() { return 'msg_demo_' + Math.random().toString(36).slice(2, 12); }

  /** Demo only (?aidemo=1): a canned Message. Nothing is sent to Claude. */
  H.aiMessage = function (args) {
    if (!aiDemo) fail('UNSUPPORTED', 'В браузере запрос к Claude отправляет сама страница.');
    var params = args && args.params && typeof args.params === 'object' ? args.params : null;
    if (!params || !G.ai) fail('AI_BAD_REQUEST', 'Пустой запрос.');
    var model = typeof params.model === 'string' ? params.model : aiDefaultModel();
    function message(text, inTok, outTok) {
      return {
        id: demoId(), type: 'message', role: 'assistant', model: model, demo: true,
        stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
        content: [{ type: 'text', text: text }],
        usage: { input_tokens: inTok, output_tokens: outTok }
      };
    }
    var structured = params.output_config && params.output_config.format;
    if (!structured) {
      return message('Демо-режим: здесь ответил бы Claude. Добавь ключ Claude API в настройках ИИ, ' +
        'и я смогу по-настоящему ответить на вопрос.', Math.round(rnd(2600, 3200)), Math.round(rnd(40, 70)));
    }
    var req = G.ai.readRequest(params);
    if (!req) fail('AI_BAD_REQUEST', 'В запросе нет данных устройства.');
    return G.ai.localPlan({ goal: req.goal, context: req.context }).then(function (r) {
      var plan = r.plan;
      plan.summary = 'Демо: так выглядит план ИИ, но этот собран по правилам GinN — запрос к Claude не отправлялся.';
      return message(JSON.stringify(plan), Math.round(rnd(3300, 3700)), Math.round(rnd(800, 1000)));
    });
  };

  /* ------------------------------------------------------------ dispatch */

  var LATENCY = {
    info: [80, 140], stats: [80, 160], tweaks: [120, 260], hardware: [150, 320],
    applyTweak: [250, 450], revertAll: [320, 450], applyGameProfile: [300, 450], launchGame: [200, 400],
    aiMessage: [1300, 1700], aiStatus: [40, 90], aiConfigure: [60, 120], aiClear: [60, 120], aiKey: [30, 60]
  };

  var mock = {
    /** 'android' | 'windows' (from ?platform=) */
    flavour: flavour,
    /** true with ?aidemo=1: AI answers are canned demo plans (transport 'mock'). */
    aiDemo: aiDemo,
    /** Multiplies the fake latency (tests set it low). */
    latencyScale: 1,
    /** Contract call: resolves {ok:true,data} or {ok:false,code,error}; never rejects. */
    call: function (method, args) {
      var range = LATENCY[method] || [100, 300];
      var delay = Math.round(rnd(range[0], range[1]) * mock.latencyScale);
      return new Promise(function (resolve) { setTimeout(resolve, delay); }).then(function () {
        if (!Object.prototype.hasOwnProperty.call(H, method)) fail('UNSUPPORTED', 'Неизвестная команда: ' + method);
        return H[method](args || {});
      }).then(function (data) {
        return { ok: true, data: data === undefined ? {} : data };
      }, function (e) {
        return { ok: false, code: (e && e.code) || 'FAILED', error: (e && e.code ? e.message : 'Ошибка демо-режима: ' + (e && e.message)) };
      });
    },
    /** Clears the mock state for this tab (dev helper). */
    reset: function () {
      try { window.sessionStorage.removeItem(STATE_KEY); window.sessionStorage.removeItem(ADMIN_KEY); } catch (e) { /* ignore */ }
    }
  };

  G.mock = mock;
})(window.GinN);
