/* GinN — Главная: optimization ring + optimize-all, device class, hardware grid, live mini-stats, detected games. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  G.pages = G.pages || {};

  function deviceIcon(hw) {
    var t = hw && hw.device && hw.device.type;
    return t === 'laptop' ? 'laptop' : t === 'desktop' ? 'monitor' : 'smartphone';
  }

  function cpuSub(cpu) {
    var f = G.fmt, parts = [];
    if (!cpu) return '';
    if (cpu.cores) parts.push(f.count(cpu.cores, 'ядро', 'ядра', 'ядер'));
    if (cpu.threads && cpu.threads !== cpu.cores) parts.push(f.count(cpu.threads, 'поток', 'потока', 'потоков'));
    if (cpu.maxMHz) parts.push('до ' + f.mhz(cpu.maxMHz));
    return parts.join(' · ');
  }

  G.pages.dashboard = {
    title: 'Главная',
    mount: function (root, ctx) {
      var ui = G.ui, h = ui.h, app = ctx.app, fmt = G.fmt, host = G.host;
      var alive = true;
      var offs = [];
      var hw = null;

      /* ---------------- hero */
      var ring = ui.ring({ label: 'оптимизация' });
      ring.classList.add('is-loading');
      var statusTitle = h('h2.hero-title', h('span.sk.sk-inline', { style: { width: '220px', height: '26px' } }));
      var statusText = h('p.hero-text', h('span.sk.sk-inline', { style: { width: '260px', height: '14px' } }));
      var hints = h('div.hero-hints');
      var cta = ui.btn({
        label: 'Оптимизировать', icon: 'zap', variant: 'primary', size: 'lg', cls: 'btn-glow',
        busyLabel: 'Оптимизирую…', onClick: function () { return app.optimizeAll(); }
      });
      var revert = ui.btn({ label: 'Откатить', icon: 'rotate-ccw', variant: 'ghost', size: 'lg', onClick: function () { return app.revertAll(); } });
      var mini = miniStats();
      var hero = h('section.card.hero',
        h('div.hero-bg', { 'aria-hidden': 'true' }),
        h('div.hero-main',
          h('div.hero-ring', ring),
          h('div.hero-body',
            h('div.kicker', ui.icon('sparkles', null, 16), 'Состояние системы'),
            statusTitle, statusText,
            h('div.hero-actions', cta, revert),
            hints)),
        mini.el);

      /* ---------------- device card */
      var deviceCard = h('section.card.device', deviceSkeleton());

      /* ---------------- GinN AI promo */
      var aiCard = aiPromo();

      /* ---------------- hardware */
      var hwGrid = h('div.hw-grid', [0, 1, 2, 3, 4, 5].map(function () { return h('div.card.hw-tile.is-sk', ui.skeleton({ h: 40, w: '40px' }), ui.skeleton({ h: 12, w: '40%' }), ui.skeleton({ h: 18, w: '80%' }), ui.skeleton({ h: 12, w: '60%' })); }));

      /* ---------------- games */
      var gamesRow = h('div.games-row', [0, 1, 2, 3].map(function () { return h('div.game-mini.is-sk', ui.skeleton({ h: 64, w: '64px' }), ui.skeleton({ h: 12, w: '70%' })); }));

      root.appendChild(ui.pageHead({ title: 'Главная', sub: 'Твоё устройство, его класс и одна кнопка, чтобы выжать из него максимум' }));
      root.appendChild(h('div.dash-top', hero, aiCard.el, deviceCard));
      root.appendChild(ui.section('Железо', { sub: 'Что внутри и как оно сейчас работает' }));
      root.appendChild(hwGrid);
      root.appendChild(ui.section('Твои игры', {
        extra: h('a.sec-link', { href: '#/games' }, 'Все игры', ui.icon('chevron-right', null, 16))
      }));
      root.appendChild(gamesRow);

      /* ---------------- live refs (filled by renderHardware) */
      var live = { ramSub: null, ramBar: null, tempVal: null, tempSub: null, tempChip: null };

      /* ---------------- optimization state */
      function renderOpt(list) {
        if (!alive) return;
        var st = app.optState(list);
        ring.classList.remove('is-loading');
        ring.set(st.pct);
        ui.clear(statusTitle);
        ui.clear(statusText);
        ui.clear(hints);
        var full = st.pct >= 100;
        hero.classList.toggle('is-full', full);
        statusTitle.appendChild(document.createTextNode(full ? 'Оптимизировано' : 'Система не оптимизирована'));
        if (full) {
          statusText.textContent = st.total
            ? 'Включено ' + st.done + ' из ' + st.total + ' ' + fmt.plural(st.total, 'рекомендации', 'рекомендаций', 'рекомендаций') + ' — можно играть.'
            : 'Рекомендаций нет — система уже в порядке.';
        } else {
          statusText.textContent = 'Включено ' + st.done + ' из ' + st.total + ' ' + fmt.plural(st.total, 'рекомендации', 'рекомендаций', 'рекомендаций') +
            (st.auto.length - st.adminBlocked.length > 0 ? '. Нажми «Оптимизировать» — остальное GinN включит сам.' : '.');
        }
        cta.setLabel(full ? 'Проверить ещё раз' : 'Оптимизировать');
        if (st.adminBlocked.length) {
          hints.appendChild(h('button', { type: 'button', class: 'hint hint-warn', onClick: function () { app.promptAdmin(); } },
            ui.icon('shield', null, 16),
            h('span', fmt.count(st.adminBlocked.length, 'пункт требует', 'пункта требуют', 'пунктов требуют') + ' прав администратора'),
            h('span.hint-act', 'Перезапустить')));
        }
        if (st.manual.length) {
          hints.appendChild(h('a', { class: 'hint', href: '#/optimize' },
            ui.icon('external-link', null, 16),
            h('span', 'Ещё ' + fmt.count(st.manual.length, 'пункт', 'пункта', 'пунктов') + ' — вручную в настройках'),
            h('span.hint-act', 'Открыть')));
        }
        if (app.rebootNeeded) {
          hints.appendChild(h('div.hint.hint-info', ui.icon('rotate-ccw', null, 16), h('span', 'Перезагрузи компьютер, чтобы всё заработало')));
        }
      }

      function loadOpt(force) {
        app.tweaks(force).then(renderOpt, function (e) {
          if (!alive) return;
          ring.classList.remove('is-loading');
          ui.clear(statusTitle); ui.clear(statusText);
          statusTitle.textContent = 'Не удалось проверить систему';
          statusText.textContent = e.message || '';
          ui.clear(hints);
          hints.appendChild(ui.btn({ label: 'Повторить', icon: 'refresh', variant: 'ghost', size: 'sm', onClick: function () { loadOpt(true); } }));
        });
      }
      offs.push(G.bus.on('ui:tweaks', renderOpt));
      offs.push(G.bus.on('ui:reboot', function () { renderOpt(app.lastTweaks); }));

      /* ---------------- device + hardware */
      function deviceSkeleton() {
        return [h('div.device-top', ui.skeleton({ h: 48, w: '48px', cls: 'sk-round' }), h('div.grow', ui.skeleton({ h: 18, w: '70%' }), ui.skeleton({ h: 12, w: '45%' }))),
          ui.skeleton({ h: 64 }), ui.skeleton({ h: 10 })];
      }

      function renderDevice(hw) {
        var cls = app.classify(hw);
        var d = hw.device || {}, os = hw.os || {};
        ui.clear(deviceCard);
        var sub = [os.name, d.model && d.model !== d.name ? d.model : null].filter(Boolean).join(' · ');
        deviceCard.appendChild(h('div.device-top',
          h('div.icon-tile.tone-violet', ui.icon(deviceIcon(hw), null, 24)),
          h('div.grow', h('div.device-name', d.name || 'Устройство'), h('div.device-sub', sub))));
        var tierBlock = h('div.tier',
          h('div.tier-label', 'Класс устройства'),
          h('div.tier-row',
            h('div.tier-name', cls.tierName),
            h('div.tier-steps', { 'aria-label': 'Уровень ' + cls.tier + ' из 4' }, [1, 2, 3, 4].map(function (n) {
              return h('span', { class: ['tier-step', n <= cls.tier ? 'is-on' : null] });
            }))),
          h('div.score-row', h('span.score-label', 'Оценка железа'), h('span.score-val', h('b', String(cls.score)), ' / 100')),
          ui.bar(cls.score, 'grad'));
        deviceCard.appendChild(tierBlock);
        if (cls.notes && cls.notes.length) {
          deviceCard.appendChild(h('ul.notes', cls.notes.slice(0, 3).map(function (n) { return h('li', ui.icon('info', null, 16), h('span', n)); })));
        } else {
          deviceCard.appendChild(h('ul.notes', h('li', ui.icon('check-circle', null, 16), h('span', 'Железо известно GinN — оценка точная'))));
        }
      }

      function tile(o) {
        return h('div', { class: ['card', 'hw-tile', o.cls] },
          h('div.hw-head', h('div', { class: ['icon-tile', 'tone-' + (o.tone || 'violet')] }, ui.icon(o.icon, null, 22)), h('div.hw-label', o.label), o.badge || null),
          h('div.hw-value', o.value || '—'),
          o.sub ? (o.sub.nodeType ? o.sub : h('div.hw-sub', o.sub)) : null,
          o.extra || null);
      }

      function renderHardware(hwData) {
        hw = hwData;
        var d = G.devices, f = fmt;
        ui.clear(hwGrid);
        var tiles = [];
        // CPU
        var cpuName = '';
        try { cpuName = d.prettyCpu(hw.cpu); } catch (e) { cpuName = (hw.cpu && hw.cpu.name) || ''; }
        tiles.push(tile({ icon: 'cpu', label: 'Процессор', value: cpuName || 'Неизвестный процессор', sub: cpuSub(hw.cpu), tone: 'violet' }));
        // GPU
        var gpu = app.gpuName(hw);
        var gsub = hw.gpu && hw.gpu.vramMB ? f.mb(hw.gpu.vramMB) + ' видеопамяти' : (app.platform === 'android' ? 'Встроена в чип' : '');
        tiles.push(tile({ icon: 'gpu', label: 'Видеокарта', value: gpu || 'Не удалось определить', sub: gsub, tone: 'cyan' }));
        // RAM
        var ram = hw.ram || {};
        var usedPct = ram.totalMB ? Math.round((1 - (ram.availMB || 0) / ram.totalMB) * 100) : 0;
        live.ramSub = h('div.hw-sub', 'Занято ' + f.pct(usedPct) + ' · свободно ' + f.mb(ram.availMB));
        live.ramBar = ui.bar(usedPct, usedPct > 85 ? 'bad' : usedPct > 70 ? 'warn' : 'cyan');
        tiles.push(tile({ icon: 'memory', label: 'Оперативная память', value: f.mb(ram.totalMB), sub: live.ramSub, extra: live.ramBar, tone: 'cyan' }));
        // Storage
        var s = hw.storage || {};
        var usedS = s.totalGB ? Math.round((1 - (s.freeGB || 0) / s.totalGB) * 100) : 0;
        tiles.push(tile({
          icon: 'hard-drive', label: 'Память', value: f.gb(s.freeGB) + ' свободно',
          sub: 'из ' + f.gb(s.totalGB), badge: s.type ? ui.badge(s.type, 'muted') : null,
          extra: ui.bar(usedS, usedS > 90 ? 'bad' : usedS > 80 ? 'warn' : 'violet'), tone: 'violet'
        }));
        // Display
        var disp = hw.display || {};
        var cur = Math.round(disp.refreshHz || 0), max = Math.round(disp.maxRefreshHz || 0);
        var canMore = cur > 0 && max > cur + 1;
        var dispExtra = null;
        if (canMore) {
          dispExtra = h('div.hw-callout',
            ui.icon('alert', null, 16),
            h('span', 'Экран умеет ' + f.hz(max) + ', а работает на ' + f.hz(cur)),
            app.platform === 'android' ? h('button', {
              type: 'button', class: 'link-btn',
              onClick: function () { host.openSettings({ target: 'display' }).catch(app.handleError); }
            }, 'Включить') : null);
        }
        tiles.push(tile({
          icon: 'monitor', label: 'Экран', value: disp.width && disp.height ? disp.width + ' × ' + disp.height : '—',
          sub: max > cur ? f.hz(cur) + ' · до ' + f.hz(max) : f.hz(cur || max),
          badge: canMore ? ui.badge('Можно ' + f.hz(max), 'warn') : (max ? ui.badge(f.hz(max), 'good') : null),
          extra: dispExtra, cls: canMore ? 'is-warn' : null, tone: canMore ? 'warn' : 'cyan'
        }));
        // Battery or thermal
        var b = hw.battery;
        if (b && b.present !== false) {
          var lvl = Math.round(b.level || 0);
          tiles.push(tile({
            icon: b.charging ? 'battery-charging' : 'battery', label: 'Батарея', value: f.pct(lvl),
            sub: (b.charging ? 'Заряжается' : 'Не заряжается') + (b.tempC != null ? ' · ' + f.temp(b.tempC) : ''),
            extra: ui.bar(lvl, lvl < 20 ? 'bad' : lvl < 45 ? 'warn' : 'good'), tone: 'good'
          }));
        } else {
          live.tempVal = h('div.hw-value', '—');
          live.tempSub = h('div.hw-sub', 'Жду данные датчика…');
          live.tempChip = h('span');
          tiles.push(h('div.card.hw-tile',
            h('div.hw-head', h('div.icon-tile.tone-warn', ui.icon('thermometer', null, 22)), h('div.hw-label', 'Температура'), live.tempChip),
            live.tempVal, live.tempSub));
        }
        tiles.forEach(function (t) { hwGrid.appendChild(t); });
        mini.setHw(hw);
      }

      function loadHw() {
        app.hardware().then(function (data) {
          if (!alive) return;
          renderDevice(data);
          renderHardware(data);
        }, function (e) {
          if (!alive) return;
          ui.clear(hwGrid);
          hwGrid.appendChild(h('div.card.span-all', ui.errorState(e, function () { app.hardware(true); loadHw(); })));
          ui.clear(deviceCard);
          deviceCard.appendChild(ui.errorState(e, null, 'Нет данных об устройстве'));
        });
      }

      /* ---------------- live stats */
      function onStats(s) {
        if (!alive || !s) return;
        mini.update(s);
        if (live.ramSub && hw && hw.ram) {
          live.ramSub.textContent = 'Занято ' + fmt.pct(s.ramUsedPct) + ' · свободно ' + fmt.mb(s.ramAvailMB);
          live.ramBar.set(s.ramUsedPct, s.ramUsedPct > 85 ? 'bad' : s.ramUsedPct > 70 ? 'warn' : 'cyan');
        }
        if (live.tempVal) {
          live.tempVal.textContent = s.tempC != null ? fmt.temp(s.tempC) : 'Нет датчика';
          live.tempSub.textContent = s.tempC != null ? (s.tempSource === 'battery' ? 'Датчик батареи' : 'Датчик процессора') : 'Система не отдаёт температуру';
          ui.clear(live.tempChip);
          var th = ui.thermal(s);
          if (th) live.tempChip.appendChild(th);
        }
      }

      /* ---------------- games */
      function loadGames() {
        app.games().then(function (list) {
          if (!alive) return;
          ui.clear(gamesRow);
          if (!list.length) {
            gamesRow.appendChild(h('div.card.games-empty',
              ui.icon('gamepad', null, 22),
              h('div', h('div.games-empty-title', 'Игры не найдены'), h('div.games-empty-text', 'Загляни в каталог — там настройки для популярных игр.')),
              h('a.btn.btn-ghost.btn-sm', { href: '#/games' }, 'Каталог')));
            return;
          }
          list.slice(0, 10).forEach(function (x) {
            var g = x.game;
            var limit = null;
            if (g && hw) { try { limit = G.games.fpsLimit(g, hw, app.platform); } catch (e) { limit = null; } }
            var id = g ? g.id : x.installed.id;
            gamesRow.appendChild(h('a', { class: 'game-mini', href: '#/games/' + encodeURIComponent(id) },
              ui.gameArt(g || { name: x.installed.name }, x.installed, 'md'),
              h('div.game-mini-name', (g && g.name) || x.installed.name),
              h('div.game-mini-sub', limit && limit.supported ? 'до ' + (limit.max >= 1000 ? '∞' : limit.max) + ' FPS' : (app.SOURCE[x.installed.source] || ''))));
          });
        }, function (e) {
          if (!alive) return;
          ui.clear(gamesRow);
          gamesRow.appendChild(h('div.card.games-empty', ui.errorState(e, function () { app.games(true); loadGames(); })));
        });
      }

      loadOpt(false);
      loadHw();
      app.hardware().then(function () { if (alive) loadGames(); }, function () { if (alive) loadGames(); });
      offs.push(app.stats.subscribe(onStats));

      offs.push(G.bus.on('ui:ai', function () { aiCard.load(); }));

      return {
        unmount: function () { alive = false; offs.forEach(function (f) { f(); }); },
        refresh: function () { loadHw(); loadOpt(false); aiCard.load(); }
      };

      /* ---------------- GinN AI card */
      function aiPromo() {
        var status = h('div.ai-promo-status', ui.skeleton({ h: 24, w: '60%' }));
        var go = ui.btn({ label: 'Открыть GinN AI', icon: 'sparkles', variant: 'soft', block: true, onClick: function () { app.go('ai'); } });
        var el = h('section.card.ai-promo',
          h('div.ai-promo-glow', { 'aria-hidden': 'true' }),
          h('div.ai-promo-head',
            h('span.ai-promo-ico', ui.icon('sparkles', null, 22)),
            h('div', h('div.ai-promo-kicker', 'GinN AI'), h('h2.ai-promo-title', 'ИИ-оптимизация'))),
          h('p.ai-promo-text', 'Claude изучит железо, настройки и игры и соберёт личный план: что включить и какой лимит FPS поставить.'),
          status, go);
        function load() {
          if (!G.ai) { ui.clear(status); status.appendChild(ui.badge('Модуль ИИ не загрузился', 'bad', 'alert')); return; }
          G.ai.status().then(function (st) {
            if (!alive) return;
            ui.clear(status);
            var last = G.aiUi && G.aiUi.lastResult();
            if (st.available === false) {
              status.appendChild(ui.badge('Недоступно в этой версии', 'muted', 'info'));
              go.setLabel('Базовый анализ');
            } else if (!st.configured) {
              status.appendChild(ui.badge('Нужен ключ Claude API', 'warn', 'key'));
              go.setLabel('Подключить ИИ');
            } else {
              status.appendChild(st.transport === 'mock' ? ui.badge('Демо', 'warn', 'info') : ui.badge('Ключ добавлен', 'good', 'check'));
              status.appendChild(h('span.ai-promo-model', G.aiUi ? G.aiUi.modelName(st.model) : st.model));
              go.setLabel(last ? 'Открыть план' : 'Анализировать с ИИ');
            }
            if (last && last.plan) {
              status.appendChild(h('span.ai-promo-last', 'Последний план: ' + fmt.count(last.plan.steps.length, 'шаг', 'шага', 'шагов')));
            }
          });
        }
        load();
        return { el: el, load: load };
      }

      /* ---------------- helpers */
      function miniStats() {
        var cells = {};
        function cell(key, icon, label, short) {
          var val = h('div.mini-val', '—');
          var lab = h('div.mini-label');
          var b = ui.bar(0, 'grad');
          lab.set = function (long, sh) {
            ui.clear(lab);
            lab.appendChild(h('span.lbl-long', long));
            lab.appendChild(h('span.lbl-short', sh || long));
            lab.title = long;
          };
          lab.set(label, short);
          cells[key] = { val: val, label: lab, bar: b };
          return h('div.mini', h('div.mini-head', ui.icon(icon, null, 16), lab), val, b);
        }
        var maxMHz = null;
        var el = h('div.mini-strip', { 'aria-live': 'off' },
          h('a.mini-live', { href: '#/monitor', title: 'Открыть мониторинг' },
            h('span.live-dot'), h('span', 'Сейчас'), h('span.mini-more', 'Мониторинг', ui.icon('chevron-right', null, 14))),
          cell('cpu', 'cpu', 'Процессор', 'ЦП'), cell('ram', 'memory', 'ОЗУ'), cell('temp', 'thermometer', 'Температура', 'Темп.'));
        return {
          el: el,
          setHw: function (hw) { maxMHz = hw && hw.cpu && hw.cpu.maxMHz; },
          update: function (s) {
            if (s.cpuLoad != null) {
              cells.cpu.label.set('Процессор', 'ЦП');
              cells.cpu.val.textContent = fmt.pct(s.cpuLoad);
              cells.cpu.bar.set(s.cpuLoad);
            } else if (s.cpuMHz != null) {
              cells.cpu.label.set('Частота ЦП', 'Частота');
              cells.cpu.val.textContent = fmt.mhz(s.cpuMHz);
              cells.cpu.bar.set(maxMHz ? s.cpuMHz / maxMHz * 100 : 50);
            } else {
              cells.cpu.val.textContent = 'Нет данных';
            }
            cells.ram.val.textContent = fmt.pct(s.ramUsedPct);
            cells.ram.bar.set(s.ramUsedPct);
            if (s.tempC != null) {
              cells.temp.val.textContent = fmt.temp(s.tempC);
              cells.temp.label.set('Температура', 'Темп.');
              cells.temp.label.title = s.tempSource === 'battery' ? 'Датчик батареи' : 'Датчик процессора';
              var hot = s.tempSource === 'battery' ? s.tempC >= 42 : s.tempC >= 85;
              var warm = s.tempSource === 'battery' ? s.tempC >= 38 : s.tempC >= 72;
              cells.temp.bar.set(G.clamp((s.tempC - 20) / ((s.tempSource === 'battery' ? 50 : 100) - 20) * 100, 0, 100), hot ? 'bad' : warm ? 'warn' : 'grad');
            } else {
              cells.temp.val.textContent = 'Нет датчика';
              cells.temp.bar.set(0);
            }
          }
        };
      }
    }
  };

})(window.GinN);
