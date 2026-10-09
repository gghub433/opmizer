/* GinN — app boot: shell (sidebar / top bar + bottom tabs), hash router, shared services (GinN.app):
 * cached hardware/tweaks/games, live stats feed, optimize-all flow, revert, admin prompt, error handling. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  var ui = G.ui, h = ui.h;
  var host = G.host;

  /* Desktop sidebar: all 6. Mobile bottom bar: 5 (no Мониторинг; it opens from Главная and Настройки). */
  var NAV = [
    { id: 'dashboard', title: 'Главная', icon: 'home', tab: true },
    { id: 'optimize', title: 'Оптимизация', icon: 'zap', tab: true },
    { id: 'ai', title: 'ИИ', icon: 'sparkles', tab: true, accent: true },
    { id: 'games', title: 'Игры', icon: 'gamepad', tab: true },
    { id: 'monitor', title: 'Мониторинг', icon: 'activity', tab: false },
    { id: 'settings', title: 'Настройки', icon: 'settings', tab: true }
  ];

  var CATEGORY = {
    power: { title: 'Питание', icon: 'power' },
    graphics: { title: 'Графика', icon: 'layers' },
    system: { title: 'Система', icon: 'sliders' },
    input: { title: 'Ввод', icon: 'mouse' },
    network: { title: 'Сеть', icon: 'wifi' },
    cleanup: { title: 'Очистка', icon: 'broom' },
    android: { title: 'Android', icon: 'smartphone' }
  };
  var CATEGORY_ORDER = ['power', 'graphics', 'system', 'input', 'network', 'cleanup', 'android'];
  var IMPACT = { fps: 'FPS', latency: 'Задержка', network: 'Сеть', ram: 'ОЗУ', battery: 'Батарея', temps: 'Температура', storage: 'Память' };
  var SOURCE = { android: 'Установлена', steam: 'Steam', epic: 'Epic Games', riot: 'Riot Games', minecraft: 'Minecraft Launcher', roblox: 'Roblox', battlenet: 'Battle.net' };

  /* ------------------------------------------------------------ session */

  function ssGet(k) { try { return JSON.parse(window.sessionStorage.getItem('ginn.ui.' + k)); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem('ginn.ui.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  var app = {
    NAV: NAV, CATEGORY: CATEGORY, CATEGORY_ORDER: CATEGORY_ORDER, IMPACT: IMPACT, SOURCE: SOURCE,
    info: null,
    platform: 'android',   // data platform for catalog / classify: 'android' | 'windows'
    route: { id: 'dashboard', params: [] },
    ranActions: ssGet('ranActions') || {},   // action tweaks run in this session (hosts may keep state 'off')
    rebootNeeded: !!ssGet('reboot'),
    lastTweaks: null,
    lastGames: null,
    hw: null
  };

  /** Windows host that reports isAdmin === false (Android/web never "lack" admin). */
  app.notAdmin = function () { return !!(app.info && app.info.platform === 'windows' && app.info.isAdmin === false); };
  app.canElevate = function () { return host.has('admin') || (app.info && app.info.platform === 'windows'); };
  app.isWindows = function () { return app.platform === 'windows'; };

  /* -------------------------------------------------------------- data */

  var hwP = null;
  /** Cached hardware. force = refetch. */
  app.hardware = function (force) {
    if (!hwP || force) {
      var p = host.hardware().then(function (hw) { app.hw = hw; return hw; });
      p.catch(function () { if (hwP === p) hwP = null; });
      hwP = p;
    }
    return hwP;
  };
  app.classify = function (hw) {
    try { return G.devices.classify(hw, app.platform); } catch (e) { return { tier: 2, tierName: 'Средний', score: 50, notes: [] }; }
  };
  app.gpuName = function (hw) { try { return host.gpuName(hw); } catch (e) { return null; } };

  var twP = null;
  /** Tweaks list; emits 'ui:tweaks' with the fresh list. */
  app.tweaks = function (force) {
    if (!twP || force) {
      var p = host.tweaks().then(function (list) {
        app.lastTweaks = Array.isArray(list) ? list : [];
        G.bus.emit('ui:tweaks', app.lastTweaks);
        return app.lastTweaks;
      });
      p.catch(function () { if (twP === p) twP = null; });
      twP = p;
    }
    return twP;
  };

  var gamesP = null;
  /** Installed games resolved against the catalog: [{installed, game|null}] */
  app.games = function (force) {
    if (!gamesP || force) {
      var known = [];
      try { known = G.games.allPackages(); } catch (e) { known = []; }
      var p = host.games({ knownPackages: known }).then(function (list) {
        var seen = {};
        var out = (Array.isArray(list) ? list : []).map(function (ig) {
          var game = null;
          try { game = G.games.byInstalled(ig); } catch (e) { game = null; }
          return { installed: ig, game: game };
        }).filter(function (x) {
          var k = x.game ? 'c:' + x.game.id : 'i:' + x.installed.id;
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        });
        app.lastGames = out;
        return out;
      });
      p.catch(function () { if (gamesP === p) gamesP = null; });
      gamesP = p;
    }
    return gamesP;
  };

  /** Optimization score from a tweak list. */
  app.optState = function (list) {
    list = list || app.lastTweaks || [];
    // Recommended auto tweaks + recommended links whose real state the host can read
    // (on Android almost everything is a link to a system screen, so links must count there).
    var items = list.filter(function (t) {
      return t.recommended && (t.kind !== 'link' || t.state === 'on' || t.state === 'off');
    });
    var isDone = function (t) { return t.state === 'on' || (t.kind === 'action' && !!app.ranActions[t.id]); };
    var done = items.filter(isDone);
    var todo = items.filter(function (t) { return !isDone(t); });
    var auto = todo.filter(function (t) { return t.kind !== 'link'; });
    var manual = todo.filter(function (t) { return t.kind === 'link'; });
    var adminBlocked = auto.filter(function (t) { return t.requiresAdmin && app.notAdmin(); });
    return {
      total: items.length, done: done.length,
      pct: items.length ? Math.round(done.length / items.length * 100) : 100,
      auto: auto, manual: manual, adminBlocked: adminBlocked
    };
  };

  app.markRan = function (id) { app.ranActions[id] = Date.now(); ssSet('ranActions', app.ranActions); };
  app.setReboot = function (v) { app.rebootNeeded = !!v; ssSet('reboot', !!v); G.bus.emit('ui:reboot', app.rebootNeeded); };

  /* -------------------------------------------------------- live stats */

  var stats = {
    subs: [], timer: 0, busy: false, last: null, lastAt: 0, err: null,
    hist: { cpu: [], mhz: [], ram: [], temp: [], gpu: [], bat: [] }
  };
  var HIST_N = 60;
  function push(arr, v) { arr.push(typeof v === 'number' && isFinite(v) ? v : null); if (arr.length > HIST_N) arr.shift(); }
  function statsTick() {
    stats.timer = 0;
    if (!stats.subs.length || document.hidden || stats.busy) return;
    stats.busy = true;
    host.stats().then(function (s) {
      var now = Date.now();
      if (stats.lastAt && now - stats.lastAt > 12000) Object.keys(stats.hist).forEach(function (k) { stats.hist[k] = []; });
      stats.lastAt = now;
      stats.last = s;
      stats.err = null;
      if (G.ai && typeof G.ai.recordStats === 'function') { try { G.ai.recordStats(s); } catch (e) { /* optional */ } }
      push(stats.hist.cpu, s.cpuLoad);
      push(stats.hist.mhz, s.cpuMHz);
      push(stats.hist.ram, s.ramUsedPct);
      push(stats.hist.temp, s.tempC);
      push(stats.hist.gpu, s.gpuLoad);
      push(stats.hist.bat, s.batteryLevel);
    }, function (e) { stats.err = e; }).then(function () {
      stats.busy = false;
      stats.subs.slice().forEach(function (cb) { try { cb(stats.last, stats.hist, stats.err); } catch (e) { console.error(e); } });
      schedule();
    });
  }
  function schedule() {
    if (stats.timer || !stats.subs.length || document.hidden) return;
    stats.timer = setTimeout(statsTick, 1500);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(stats.timer); stats.timer = 0; }
    else if (stats.subs.length && !stats.busy) { clearTimeout(stats.timer); stats.timer = 0; statsTick(); }
  });
  /** subscribe(cb(stats, history, err)) -> unsubscribe. Polls every 1.5 s while anyone listens and the page is visible. */
  app.stats = {
    subscribe: function (cb) {
      stats.subs.push(cb);
      if (stats.last && Date.now() - stats.lastAt < 5000) { try { cb(stats.last, stats.hist, null); } catch (e) { console.error(e); } }
      if (!stats.timer && !stats.busy) statsTick();
      return function () {
        var i = stats.subs.indexOf(cb);
        if (i >= 0) stats.subs.splice(i, 1);
        if (!stats.subs.length) { clearTimeout(stats.timer); stats.timer = 0; }
      };
    },
    history: function () { return stats.hist; },
    last: function () { return stats.last; },
    active: function () { return stats.subs.length > 0; }
  };

  /* ------------------------------------------------------ error helpers */

  function permissionTarget(t) {
    if (!t) return null;
    var s = (t.id + ' ' + (t.title || '')).toLowerCase();
    return /dnd|не беспокоить/.test(s) ? 'dnd_access' : null;
  }

  /** Shows a friendly toast / prompt for a host error. ctx: {tweak} */
  app.handleError = function (e, ctx) {
    var code = e && e.code;
    var msg = (e && e.message) || 'Не получилось. Попробуй ещё раз.';
    if (code === 'NEEDS_PERMISSION') {
      var target = permissionTarget(ctx && ctx.tweak) || (ctx && ctx.target);
      ui.toast(msg, {
        tone: 'warn',
        action: target ? { label: 'Разрешить', onClick: function () { host.openSettings({ target: target }).catch(app.handleError); } } : null
      });
      return;
    }
    if (code === 'NEEDS_ADMIN') { app.promptAdmin(msg); return; }
    ui.toast(msg, { tone: code === 'UNSUPPORTED' ? 'warn' : 'bad' });
  };

  /** Applies one tweak with friendly errors. Resolves the result or null. */
  app.applyTweak = function (t, enable) {
    return host.applyTweak({ id: t.id, enable: enable !== false }).then(function (r) {
      r = r || {};
      if (t.kind === 'action') app.markRan(t.id);
      if (r.needsReboot) app.setReboot(true);
      if (r.state) t.state = r.state;
      G.bus.emit('ui:tweak', { id: t.id, state: t.state, result: r });
      return r;
    }, function (e) {
      app.handleError(e, { tweak: t });
      return null;
    });
  };

  /** Windows: ask to relaunch elevated. */
  app.promptAdmin = function (reason) {
    if (!app.canElevate()) { ui.toast(reason || 'Нужны права администратора.', { tone: 'warn' }); return Promise.resolve(false); }
    return ui.confirm({
      title: 'Нужны права администратора',
      text: (reason ? reason + ' ' : '') + 'GinN закроется и сразу откроется снова — Windows спросит разрешение. Остальные настройки сохранятся.',
      ok: 'Перезапустить', okIcon: 'shield', icon: 'shield'
    }).then(function (yes) {
      if (!yes) return false;
      return host.relaunchAsAdmin().then(function () {
        ui.toast('Перезапускаю GinN от имени администратора…', { tone: 'info' });
        return true;
      }, function (e) { app.handleError(e); return false; });
    });
  };

  /** Confirm + revertAll + summary. */
  app.revertAll = function () {
    return ui.confirm({
      title: 'Откатить все изменения?',
      text: 'GinN вернёт настройки системы и игр, которые менял сам, — из сохранённых копий. Ничего другого не тронет.',
      ok: 'Откатить', okIcon: 'rotate-ccw', danger: true
    }).then(function (yes) {
      if (!yes) return null;
      return host.revertAll().then(function (r) {
        r = r || {};
        var ok = (r.reverted || []).length, bad = (r.failed || []).length;
        app.ranActions = {}; ssSet('ranActions', {});
        app.setReboot(false);
        if (!ok && !bad) ui.toast('Откатывать нечего — GinN ещё ничего не менял', { tone: 'info' });
        else if (!bad) ui.toast('Готово: откачено ' + G.fmt.count(ok, 'изменение', 'изменения', 'изменений'), { tone: 'good' });
        else {
          var needAdmin = (r.failed || []).some(function (f) { return /администратор/i.test(f.error || ''); });
          ui.toast('Откачено: ' + ok + '. Не получилось: ' + bad + (needAdmin ? ' — нужны права администратора' : ''), {
            tone: 'warn', action: needAdmin && app.canElevate() ? { label: 'Права', onClick: function () { app.promptAdmin(); } } : null
          });
        }
        return app.tweaks(true).catch(function () { return null; }).then(function () { return r; });
      }, function (e) { app.handleError(e); return null; });
    });
  };

  /* -------------------------------------------------- optimize-all flow */

  var optimizing = null;
  /** The contract's "optimize all": recommended non-link tweaks that are not on, one by one, with a live step list. */
  app.optimizeAll = function () {
    if (optimizing) return optimizing;
    optimizing = app.tweaks(true).then(function (list) {
      var todo = list.filter(function (t) { return t.recommended && t.kind !== 'link' && t.state !== 'on'; });
      var st = app.optState(list);
      if (!todo.length) {
        if (st.manual.length) {
          ui.toast('Всё, что GinN может включить сам, уже включено. Ещё ' + G.fmt.count(st.manual.length, 'пункт', 'пункта', 'пунктов') + ' — в настройках системы.', {
            tone: 'info', action: { label: 'Показать', onClick: function () { app.go('optimize'); } }
          });
        } else {
          ui.toast('Всё уже оптимизировано', { tone: 'good' });
        }
        return null;
      }
      return runSteps(todo, list);
    }, function (e) { app.handleError(e); return null; }).then(function (r) { optimizing = null; return r; }, function (e) { optimizing = null; throw e; });
    return optimizing;
  };

  /**
   * Live step list in a non-dismissible sheet/modal — shared by «Оптимизировать» and «Применить план» (GinN AI).
   * stepDialog({title, icon, phase, items:[{title}]}) -> api:
   *   set(i, state:'wait'|'run'|'ok'|'skip'|'err'|'warn'|'manual', text?, extraNode?), progress(doneCount),
   *   finish({phase, headline, cells:[{n, label, tone}], errors:bool, notes:[node], actions:[modal actions]}), dlg
   */
  app.stepDialog = function (o) {
    var ICON = { wait: 'clock', ok: 'check', skip: 'minus', err: 'x', warn: 'alert', manual: 'external-link' };
    var rows = o.items.map(function (it) {
      var ico = h('span.step-ico.is-wait', { html: G.icon('clock', { size: 18 }) });
      var msg = h('div.step-msg');
      var row = h('li.step.is-wait', ico, h('div.step-text', h('div.step-title', it.title), msg));
      return { row: row, ico: ico, msg: msg };
    });
    var progressBar = ui.bar(0, 'grad');
    var phase = h('span.opt-phase', o.phase || 'Применяю…');
    var counter = h('span.opt-count', '0 из ' + rows.length);
    var headLine = h('div.opt-headline', phase, counter);
    var summary = h('div.opt-summary', { hidden: true });
    var notesEl = h('div.opt-notes');
    var listEl = h('ol.steps', rows.map(function (r) { return r.row; }));
    var body = h('div.opt-flow', headLine, progressBar, summary, notesEl, listEl);
    var dlg = ui.modal({ title: o.title, icon: o.icon || 'zap', body: body, dismissible: false, actions: [] });
    dlg.el.classList.add('modal-opt');
    return {
      dlg: dlg,
      set: function (i, state, text, extra) {
        var r = rows[i];
        if (!r) return;
        r.row.className = 'step is-' + state;
        ui.clear(r.ico);
        r.ico.className = 'step-ico is-' + state;
        if (state === 'run') r.ico.appendChild(ui.spinner());
        else r.ico.innerHTML = G.icon(ICON[state] || 'info', { size: 16, stroke: state === 'manual' ? 2.2 : 2.6 });
        ui.clear(r.msg);
        if (text) r.msg.appendChild(document.createTextNode(text));
        if (extra) { if (text) r.msg.appendChild(document.createTextNode(' ')); r.msg.appendChild(extra); }
        if (state === 'run') {
          try { r.row.scrollIntoView({ block: 'nearest', behavior: ui.reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* old engines */ }
        }
      },
      progress: function (n) {
        counter.textContent = Math.min(n, rows.length) + ' из ' + rows.length;
        progressBar.set(rows.length ? n / rows.length * 100 : 100);
      },
      finish: function (f) {
        phase.textContent = f.phase || 'Готово';
        counter.textContent = rows.length + ' из ' + rows.length;
        progressBar.set(100, f.errors ? 'warn' : 'good');
        ui.clear(summary);
        summary.appendChild(h('div.sum-ring', ui.icon(f.errors ? 'alert' : 'check', null, 26)));
        summary.appendChild(h('div.sum-main', h('div.sum-pct', f.headline || 'Готово'),
          h('div.sum-cells', (f.cells || []).map(function (c) {
            return h('div', { class: ['sum-cell', 'tone-' + (c.tone || 'muted')] }, h('b', String(c.n)), h('span', c.label));
          }))));
        summary.hidden = false;
        summary.classList.toggle('has-errors', !!f.errors);
        ui.clear(notesEl);
        (f.notes || []).forEach(function (n) { notesEl.appendChild(n); });
        dlg.setDismissible(true);
        dlg.setActions(f.actions || [{ label: 'Готово', variant: 'primary', autofocus: true }]);
        var btnEl = dlg.el.querySelector('.modal-foot .btn-primary');
        if (btnEl) { try { btnEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        try { dlg.body.scrollTop = 0; } catch (e) { /* ignore */ }
      }
    };
  };

  /** One summary note line for stepDialog().finish({notes}). */
  app.sumNote = function (iconName, text) { return h('p.sum-note', ui.icon(iconName, null, 16), h('span', text)); };

  function runSteps(todo, list) {
    var flow = app.stepDialog({ title: 'Оптимизация', icon: 'zap', phase: 'Включаю настройки…', items: todo });
    var res = { ok: 0, skipped: 0, failed: 0, admin: 0, reboot: false, permission: [] };
    var i = 0;
    function next() {
      if (i >= todo.length) return Promise.resolve();
      var idx = i++;
      var t = todo[idx];
      flow.progress(idx);
      if (t.requiresAdmin && app.notAdmin()) {
        res.skipped++; res.admin++;
        flow.set(idx, 'skip', 'Пропущено — нужны права администратора');
        flow.progress(idx + 1);
        return G.sleep(120).then(next);
      }
      flow.set(idx, 'run', 'Применяю…');
      return host.applyTweak({ id: t.id, enable: true }).then(function (out) {
        out = out || {};
        res.ok++;
        if (t.kind === 'action') app.markRan(t.id);
        if (out.state) t.state = out.state;
        if (out.needsReboot) { res.reboot = true; app.setReboot(true); }
        flow.set(idx, 'ok', out.message || 'Включено');
      }, function (e) {
        var code = e && e.code;
        if (code === 'UNSUPPORTED') { res.skipped++; flow.set(idx, 'skip', e.message); }
        else if (code === 'NEEDS_ADMIN') { res.skipped++; res.admin++; flow.set(idx, 'skip', 'Пропущено — нужны права администратора'); }
        else if (code === 'NEEDS_PERMISSION') {
          res.skipped++;
          res.permission.push(t);
          var target = permissionTarget(t);
          flow.set(idx, 'warn', e.message, target ? h('button', {
            type: 'button', class: 'link-btn',
            onClick: function () { host.openSettings({ target: target }).catch(app.handleError); }
          }, 'Разрешить') : null);
        } else { res.failed++; flow.set(idx, 'err', (e && e.message) || 'Не получилось'); }
      }).then(function () {
        flow.progress(idx + 1);
        return next();
      });
    }

    return next().then(function () {
      return app.tweaks(true).catch(function () { return list; });
    }).then(function (fresh) {
      var st = app.optState(fresh);
      var notes = [];
      if (res.admin) notes.push(app.sumNote('shield', 'Пункты с пометкой «Админ» включатся после перезапуска от имени администратора.'));
      if (res.reboot) notes.push(app.sumNote('rotate-ccw', 'Часть изменений заработает после перезагрузки компьютера.'));
      if (st.manual.length) notes.push(app.sumNote('external-link', 'Ещё ' + G.fmt.count(st.manual.length, 'пункт', 'пункта', 'пунктов') + ' ' + G.fmt.plural(st.manual.length, 'включается', 'включаются', 'включаются') + ' вручную в настройках системы — GinN откроет нужный экран.'));
      var actions = [];
      if (res.admin && app.canElevate()) actions.push({ label: 'Права администратора', icon: 'shield', variant: 'ghost', onClick: function () { setTimeout(function () { app.promptAdmin(); }, 260); } });
      else if (st.manual.length) actions.push({ label: 'Открыть список', variant: 'ghost', onClick: function () { app.go('optimize'); } });
      actions.push({ label: 'Готово', variant: 'primary', autofocus: true });
      flow.finish({
        phase: res.failed ? 'Готово, но не всё получилось' : 'Готово',
        headline: 'Оптимизация: ' + st.pct + '%',
        errors: res.failed > 0,
        cells: [
          { n: res.ok, label: G.fmt.plural(res.ok, 'включена', 'включены', 'включено'), tone: 'good' },
          { n: res.skipped, label: G.fmt.plural(res.skipped, 'пропущена', 'пропущены', 'пропущено'), tone: 'muted' },
          { n: res.failed, label: G.fmt.plural(res.failed, 'ошибка', 'ошибки', 'ошибок'), tone: 'bad' }
        ],
        notes: notes,
        actions: actions
      });
      ui.toast(res.ok ? 'Оптимизация завершена: ' + G.fmt.count(res.ok, 'настройка включена', 'настройки включены', 'настроек включено') : 'Оптимизация завершена — включать было нечего', { tone: res.failed ? 'warn' : 'good' });
      return res;
    });
  }

  /* ------------------------------------------------------------- shell */

  var els = {};
  var current = null;   // mounted page controller
  var currentId = null;

  function brand() {
    return h('div.brand', h('img.brand-logo', { src: 'assets/logo.svg', alt: '', width: 34, height: 34, draggable: 'false' }), h('span.brand-word', 'GinN'));
  }

  function platformLabel() {
    var p = app.info && app.info.platform;
    return p === 'windows' ? 'Windows' : p === 'android' ? 'Android' : 'Браузер';
  }

  function buildShell(root) {
    ui.clear(root);
    var navItems = NAV.map(function (n) {
      return h('a', { class: ['nav-item', n.accent ? 'nav-accent' : null], href: '#/' + n.id, dataset: { route: n.id } },
        h('span.nav-ico', { html: G.icon(n.icon, { size: 20 }) }), h('span.nav-label', n.title),
        n.id === 'ai' ? h('span.nav-tag', 'Claude') : null);
    });
    var foot = h('div.side-foot',
      h('div.side-ver', 'GinN ' + (app.info.appVersion || G.version)),
      h('div.side-badges',
        ui.badge(platformLabel(), 'violet', app.info.platform === 'windows' ? 'monitor' : app.info.platform === 'android' ? 'smartphone' : 'code'),
        app.info.platform === 'windows' ? (app.info.isAdmin ? ui.badge('Админ', 'good', 'shield-check') : ui.badge('Без админа', 'muted', 'shield')) : null,
        host.demo ? ui.badge('Демо', 'warn') : null));
    var side = h('aside.sidebar', { 'aria-label': 'Навигация' }, brand(), h('nav.nav', navItems), foot);

    var title = h('div.topbar-title');
    var topbar = h('header.topbar',
      h('img.topbar-logo', { src: 'assets/logo.svg', alt: 'GinN', width: 30, height: 30, draggable: 'false' }),
      title,
      h('div.topbar-end', host.demo ? ui.badge('Демо', 'warn') : null));

    var tabs = NAV.filter(function (n) { return n.tab; }).map(function (n) {
      return h('a', { class: ['tab', n.accent ? 'tab-accent' : null], href: '#/' + n.id, dataset: { route: n.id }, 'aria-label': n.accent ? 'GinN AI' : null },
        h('span.tab-ico', { html: G.icon(n.icon, { size: n.accent ? 24 : 22 }) }), h('span.tab-label', n.title));
    });
    var tabbar = h('nav.tabbar', { 'aria-label': 'Разделы' }, tabs);

    var view = h('main.view', { id: 'view', tabIndex: -1 });
    var titlebar = app.info.platform === 'windows' ? h('div.titlebar', { 'aria-hidden': 'true' }) : null;
    var shell = h('div.app', titlebar, side, topbar, view, tabbar);
    root.appendChild(shell);
    els = { shell: shell, side: side, topbar: topbar, title: title, view: view, tabbar: tabbar, nav: navItems.concat(tabs) };
  }

  /* ------------------------------------------------------------ router */

  function parseHash() {
    var raw = (window.location.hash || '').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(function (s) { return s !== ''; }).map(function (s) {
      try { return decodeURIComponent(s); } catch (e) { return s; }
    });
    var id = parts[0] || 'dashboard';
    if (!G.pages || !G.pages[id] || typeof G.pages[id].mount !== 'function') id = 'dashboard';
    return { id: id, params: parts.slice(1) };
  }

  app.go = function (path) {
    var target = '#/' + String(path || 'dashboard').replace(/^#?\/?/, '');
    if (window.location.hash === target) render();
    else window.location.hash = target;
  };
  app.setTitle = function (t) { if (els.title) els.title.textContent = t; };

  function render() {
    var r = parseHash();
    var page = G.pages[r.id];
    if (current && current.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
    current = null;
    app.route = r;
    var view = els.view;
    ui.clear(view);
    view.scrollTop = 0;
    var pageEl = h('div', { class: ['page', 'page-' + r.id, r.params.length ? 'is-subview' : null] });
    view.appendChild(pageEl);
    els.nav.forEach(function (a) {
      var on = a.dataset.route === r.id;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    app.setTitle(page.title);
    document.title = /GinN/.test(page.title) ? page.title : page.title + ' · GinN';
    try {
      current = page.mount(pageEl, { params: r.params, app: app }) || {};
    } catch (e) {
      console.error(e);
      ui.clear(pageEl);
      pageEl.appendChild(ui.errorState(e, function () { render(); }, 'Экран не открылся'));
      current = {};
    }
    currentId = r.id;
  }

  /* ------------------------------------------------------------- back */

  /* Android back: close a sheet -> page's own back (game detail, AI plan) -> go to Главная -> let the app close. */
  G.onBack = function () {
    if (ui.closeTopModal()) return true;
    if (current && typeof current.back === 'function') {
      try { if (current.back()) return true; } catch (e) { console.error(e); }
    }
    if (currentId && currentId !== 'dashboard') { app.go('dashboard'); return true; }
    return false;
  };

  /* ----------------------------------------------------------- resume */

  var resumeAt = 0;
  G.bus.on('host:resume', function () {
    var now = Date.now();
    if (now - resumeAt < 800) return;
    resumeAt = now;
    if (!app.info) return;
    app.hardware(true).catch(function () { /* page shows its own error */ });
    app.tweaks(true).catch(function () { /* ignore */ });
    if (current && typeof current.refresh === 'function') { try { current.refresh(); } catch (e) { console.error(e); } }
  });

  // Desktop: result of the background priority boost started by «Играть с ускорением».
  G.bus.on('host:boost', function (e) {
    if (e && e.message) ui.toast(String(e.message), { tone: e.ok ? 'good' : 'info' });
  });

  /* ------------------------------------------------------------- boot */

  function bootError(root, e) {
    ui.clear(root);
    root.appendChild(h('div.boot',
      h('img.boot-logo', { src: 'assets/logo.svg', alt: 'GinN', width: 72, height: 72 }),
      h('div.boot-title', 'GinN не смог запуститься'),
      h('p.boot-text', (e && e.message) || 'Нет связи с приложением.'),
      ui.btn({ label: 'Попробовать снова', icon: 'refresh', variant: 'primary', onClick: function () { start(); } })));
  }

  function start() {
    var root = document.getElementById('app');
    return host.ready().then(function (info) {
      app.info = info || {};
      var p = app.info.platform;
      app.platform = p === 'windows' ? 'windows' : p === 'android' ? 'android' : 'windows';
      if (p === 'web') {
        // plain browser host: guess the layout family from the device
        app.platform = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'android' : 'windows';
      }
      var cls = document.body.classList;
      cls.remove('host-android', 'host-windows', 'host-web', 'is-demo');
      cls.add(p === 'android' ? 'host-android' : p === 'windows' ? 'host-windows' : 'host-web');
      if (host.demo) cls.add('is-demo');
      buildShell(root);
      if (!window.location.hash) {
        // A cold start (Android may have killed GinN while the user was in Claude) with a request still out to Claude:
        // open GinN AI, where the answer is pasted.
        var landing = G.aiUi && G.aiUi.waitingForClaude && G.aiUi.waitingForClaude() ? '#/ai' : '#/dashboard';
        try { window.history.replaceState(null, '', landing); } catch (e) { window.location.hash = landing; }
      }
      render();
      // warm caches
      app.hardware().catch(function () {});
      app.tweaks().catch(function () {});
    }, function (e) { bootError(root, e); });
  }

  window.addEventListener('hashchange', function () { if (app.info) render(); });

  app.start = start;
  G.app = app;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.GinN);
