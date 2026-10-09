/* GinN — Игры: installed games + searchable catalog; game detail with FPS target, preset, recipe checklist,
 * Minecraft gray pack (Android), PC profiles and launch with boost. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  G.pages = G.pages || {};

  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim(); }

  G.pages.games = {
    title: 'Игры',
    mount: function (root, ctx) {
      var id = ctx.params[0];
      return id ? detail(root, ctx, id) : listView(root, ctx);
    }
  };

  /* ================================================================ list */

  function listView(root, ctx) {
    var ui = G.ui, h = ui.h, app = ctx.app, fmt = G.fmt;
    var alive = true;
    var hw = null;
    var sub = h('p.page-sub', 'Ищу игры на устройстве…');
    root.appendChild(h('header.page-head', h('div.page-head-row', h('div.page-head-text', h('h1.page-title', 'Игры'), sub))));

    var installedWrap = h('div.inst-grid', [0, 1, 2].map(function () {
      return h('div.card.game-card.is-sk', ui.skeleton({ h: 96, cls: 'sk-banner' }), h('div.game-card-body', ui.skeleton({ h: 16, w: '60%' }), ui.skeleton({ h: 12, w: '40%' })));
    }));
    var search = h('input.search-input', { type: 'search', placeholder: 'Найти игру', 'aria-label': 'Найти игру', autocomplete: 'off', spellcheck: 'false' });
    var clearBtn = h('button', { type: 'button', class: 'search-clear', 'aria-label': 'Очистить', hidden: true, html: G.icon('x', { size: 16 }) });
    var catalogWrap = h('div.cat-grid');
    root.appendChild(ui.section('Установлены', { sub: 'GinN нашёл их на этом устройстве' }));
    root.appendChild(installedWrap);
    root.appendChild(ui.section('Каталог', {
      sub: 'Настройки для популярных игр — даже если их ещё нет',
      extra: h('label.search', ui.icon('search', null, 18), search, clearBtn)
    }));
    root.appendChild(catalogWrap);

    var installed = [];
    var catalog = [];

    function limitText(g) {
      if (!g || !hw) return '';
      try {
        var l = G.games.fpsLimit(g, hw, app.platform);
        return l.supported ? 'до ' + (l.max >= 1000 ? '∞' : l.max) + ' FPS' : '';
      } catch (e) { return ''; }
    }

    function href(x) { return '#/games/' + encodeURIComponent(x.game ? x.game.id : x.installed.id); }

    function renderInstalled() {
      ui.clear(installedWrap);
      if (!installed.length) {
        installedWrap.appendChild(h('div.card.span-all', ui.empty({
          icon: 'gamepad', title: 'Игры не найдены',
          text: app.platform === 'android'
            ? 'GinN знает популярные игры из каталога ниже. Установи игру — и она появится здесь.'
            : 'GinN ищет игры в Steam, Epic Games, Riot, Roblox и Minecraft Launcher. Выбери игру из каталога — настройки доступны и так.'
        })));
        return;
      }
      installed.forEach(function (x) {
        var g = x.game;
        var color = (g && g.color) || '#7C5CFF';
        var lim = limitText(g);
        installedWrap.appendChild(h('a', { class: 'card game-card', href: href(x), style: { '--gc': color } },
          h('div.game-card-banner', {
            style: { background: 'radial-gradient(140% 120% at 0% 0%, ' + ui.hexA(color, 0.55) + ' 0%, ' + ui.hexA(color, 0.16) + ' 45%, rgba(16,19,28,0) 75%)' }
          }, ui.gameArt(g || { name: x.installed.name }, x.installed, 'lg')),
          h('div.game-card-body',
            h('div.game-card-name', (g && g.name) || x.installed.name),
            x.installed.source && x.installed.source !== 'android'
              ? h('div.game-card-store', app.SOURCE[x.installed.source] || x.installed.source) : null,
            h('div.game-card-meta',
              lim ? ui.badge(lim, 'violet', 'target') : ui.badge('Без рецепта', 'muted'),
              h('span.game-card-go', ui.icon('chevron-right', null, 18))))));
      });
    }

    function renderCatalog() {
      ui.clear(catalogWrap);
      var q = norm(search.value);
      clearBtn.hidden = !search.value;
      var shown = catalog.filter(function (g) { return !q || norm(g.name).indexOf(q) >= 0 || norm(g.id).indexOf(q) >= 0; });
      if (!shown.length) {
        catalogWrap.appendChild(h('div.span-all', ui.empty({ icon: 'search', title: 'Ничего не нашлось', text: 'Попробуй другое название.' })));
        return;
      }
      shown.forEach(function (g) {
        var lim = limitText(g);
        catalogWrap.appendChild(h('a', { class: 'cat-item', href: '#/games/' + encodeURIComponent(g.id) },
          ui.gameArt(g, null, 'sm'),
          h('div.cat-text', h('div.cat-name', g.name), h('div.cat-sub', lim || 'Рецепт настроек')),
          ui.icon('chevron-right', 'cat-go', 18)));
      });
    }

    search.addEventListener('input', renderCatalog);
    clearBtn.addEventListener('click', function () { search.value = ''; renderCatalog(); search.focus(); });

    Promise.all([
      app.hardware().catch(function () { return null; }),
      app.games().catch(function (e) { return { error: e }; })
    ]).then(function (r) {
      if (!alive) return;
      hw = r[0];
      var gl = r[1];
      if (gl && gl.error) {
        installed = [];
        ui.clear(installedWrap);
        installedWrap.appendChild(h('div.card.span-all', ui.errorState(gl.error, function () { app.games(true); G.app.go('games'); }, 'Не удалось найти игры')));
        sub.textContent = 'Поиск игр не удался';
      } else {
        installed = gl;
        renderInstalled();
        sub.textContent = installed.length ? 'Найдено: ' + fmt.count(installed.length, 'игра', 'игры', 'игр') : 'Установленных игр не нашлось';
      }
      var have = {};
      installed.forEach(function (x) { if (x.game) have[x.game.id] = true; });
      catalog = G.games.forPlatform(app.platform).filter(function (g) { return !have[g.id]; });
      renderCatalog();
    });

    return { unmount: function () { alive = false; } };
  }

  /* ============================================================== detail */

  function detail(root, ctx, id) {
    var ui = G.ui, h = ui.h, app = ctx.app, fmt = G.fmt, host = G.host;
    var alive = true;
    var plat = app.platform;
    var back = function () { app.go('games'); return true; };

    root.appendChild(h('button', { type: 'button', class: 'back-link', onClick: back }, ui.icon('chevron-left', null, 18), h('span', 'Все игры')));
    var body = h('div.gd', h('div.card.gd-hero.is-sk', ui.skeleton({ h: 72, w: '72px' }), h('div.grow', ui.skeleton({ h: 22, w: '50%' }), ui.skeleton({ h: 14, w: '30%' }))),
      h('div.gd-cols', h('div.card', ui.skeleton({ h: 120 })), h('div.card', ui.skeleton({ h: 220 }))));
    root.appendChild(body);

    Promise.all([
      app.hardware().catch(function () { return null; }),
      app.games().catch(function () { return []; })
    ]).then(function (r) {
      if (!alive) return;
      var hw = r[0], list = r[1] || [];
      var game = G.games.get(id);
      var inst = null;
      list.some(function (x) {
        if ((game && x.game && x.game.id === game.id) || x.installed.id === id) { inst = x; return true; }
        return false;
      });
      if (!game && inst) game = inst.game;
      ui.clear(body);
      if (!game && !inst) {
        body.appendChild(h('div.card', ui.empty({ icon: 'gamepad', title: 'Игра не найдена', text: 'Возможно, её удалили.', action: h('a.btn.btn-ghost.btn-sm', { href: '#/games' }, 'К списку игр') })));
        return;
      }
      app.setTitle(game ? game.name : inst.installed.name);
      build(body, game, inst ? inst.installed : null, hw);
    });

    function build(body, game, installed, hw) {
      var name = game ? game.name : installed.name;
      var section = game ? (plat === 'windows' ? game.pc : game.android) : null;
      var limit = game ? G.games.fpsLimit(game, hw || {}, plat) : null;
      var key = 'game.' + plat + '.' + (game ? game.id : installed.id);
      var prefs = G.store.get(key, {}) || {};
      function floorStep(v) {
        var c = limit.steps.filter(function (s) { return s <= v; });
        return c.length ? c[c.length - 1] : limit.steps[0];
      }
      var recoStep = limit ? floorStep(limit.recommended) : 60;
      var fps = limit && limit.steps.indexOf(prefs.fps) >= 0 ? prefs.fps : recoStep;
      var preset = prefs.preset === 'balanced' ? 'balanced' : 'potato';
      var isMc = !!(game && game.id === 'minecraft');
      var gray = prefs.gray !== false;
      function savePrefs() { G.store.set(key, { fps: fps, preset: preset, gray: gray }); }

      /* ---------- hero */
      var color = (game && game.color) || '#7C5CFF';
      var heroActions = h('div.gd-actions');
      if (installed && host.has('games.launch')) {
        heroActions.appendChild(ui.btn({
          label: 'Играть с ускорением', icon: 'play', variant: 'primary', cls: 'btn-glow', busyLabel: 'Запускаю…',
          onClick: function () {
            return host.launchGame({ id: installed.id, boost: true }).then(function (r) {
              ui.toast((r && r.message) || 'Запускаю ' + name + '…', { tone: 'good' });
            }, app.handleError);
          }
        }));
      }
      if (installed && plat === 'android' && /^[\w.]+$/.test(installed.id)) {
        heroActions.appendChild(ui.btn({
          label: 'О приложении', icon: 'info', variant: 'ghost', title: 'Системная страница игры: кэш, разрешения',
          onClick: function () { return host.openSettings({ target: 'app_details:' + installed.id }).catch(app.handleError); }
        }));
      }
      var srcBadge = installed ? ui.badge(installed.source === 'android' ? 'Установлена' : 'Установлена · ' + (app.SOURCE[installed.source] || installed.source), 'good', 'check')
        : ui.badge(plat === 'android' ? 'Не установлена' : 'Не найдена на ПК', 'muted');
      body.appendChild(h('section.card.gd-hero', {
        style: { background: 'radial-gradient(120% 140% at 0% 0%, ' + ui.hexA(color, 0.35) + ' 0%, ' + ui.hexA(color, 0.08) + ' 40%, rgba(16,19,28,0) 70%), var(--card-bg)' }
      },
        ui.gameArt(game || { name: name }, installed, 'xl'),
        h('div.gd-hero-text',
          h('h1.gd-title', name),
          h('div.gd-badges', srcBadge, limit && limit.supported ? ui.badge('Потолок ' + (limit.max >= 1000 ? 'без лимита' : limit.max + ' FPS'), 'violet', 'target') : null)),
        heroActions));

      if (!game || !section) {
        body.appendChild(h('div.card', ui.empty({
          icon: 'info', title: 'Для этой игры пока нет рецепта',
          text: 'GinN не знает её настроек. Общие оптимизации системы всё равно помогут.',
          action: h('a.btn.btn-ghost.btn-sm', { href: '#/optimize' }, 'К оптимизации')
        })));
        return;
      }

      var left = h('div.gd-col');
      var right = h('div.gd-col');
      body.appendChild(h('div.gd-cols', left, right));

      /* ---------- FPS */
      var capVal = h('div.cap-val');
      var capWhy = h('div.cap-why');
      var recoLine = h('div.cap-reco');
      var tierName = (G.devices.tierNames && G.devices.tierNames[limit.tier]) || '';
      function renderCap() {
        ui.clear(capVal); ui.clear(capWhy); ui.clear(recoLine);
        capVal.appendChild(h('span.cap-label', 'Потолок'));
        capVal.appendChild(h('b', limit.max >= 1000 ? 'без лимита' : limit.max + ' FPS'));
        limit.reasons.forEach(function (r, i) {
          var txt = r.label === 'экран' ? 'экран ' + r.value + ' Гц'
            : r.label === 'мощность' ? 'мощность: ' + tierName
              : 'игра ' + (r.value >= 1000 ? 'без лимита' : r.value);
          if (i) capWhy.appendChild(h('span.dot-sep', '·'));
          capWhy.appendChild(h('span', { class: ['why', r.limiting ? 'is-limit' : null], title: r.limiting ? 'Ограничивает' : '' }, txt));
        });
        if (plat === 'windows' && hw && hw.display && limit.recommended < limit.max) {
          recoLine.appendChild(ui.icon('info', null, 16));
          recoLine.appendChild(h('span', 'Монитор показывает ' + limit.recommended + ' Гц. FPS выше тоже полезен — меньше задержка ввода, но плавнее картинка не станет.'));
        } else if (fps < recoStep) {
          recoLine.appendChild(ui.icon('info', null, 16));
          recoLine.appendChild(h('span', 'Ниже потолка — стабильнее кадры, меньше нагрев и расход батареи.'));
        }
        recoLine.hidden = !recoLine.firstChild;
      }
      var fpsSeg = ui.segmented({
        pills: true, ariaLabel: 'Цель FPS', value: fps,
        options: limit.steps.map(function (s) {
          return { value: s, label: s >= 1000 ? '∞' : String(s), mark: s === recoStep, markTitle: 'Рекомендуем' };
        }),
        onChange: function (v) { fps = v; savePrefs(); renderCap(); renderChecklist(); }
      });
      renderCap();
      left.appendChild(h('section.card.gd-card',
        h('div.gd-card-head', h('div.icon-tile.tone-violet', ui.icon('target', null, 20)), h('div', h('h2.gd-card-title', 'Цель FPS'), h('p.gd-card-sub', 'Точка — рекомендуемое значение'))),
        fpsSeg, h('div.cap', capVal, capWhy), recoLine));

      /* ---------- preset */
      var presetDesc = h('p.preset-desc', G.games.presets[preset].desc);
      var presetSeg = ui.segmented({
        ariaLabel: 'Пресет графики', value: preset, cls: 'seg-wide',
        options: [
          { value: 'potato', label: G.games.presets.potato.title },
          { value: 'balanced', label: G.games.presets.balanced.title }
        ],
        onChange: function (v) { preset = v; savePrefs(); presetDesc.textContent = G.games.presets[v].desc; renderChecklist(); }
      });
      left.appendChild(h('section.card.gd-card',
        h('div.gd-card-head', h('div.icon-tile.tone-cyan', ui.icon('layers', null, 20)), h('div', h('h2.gd-card-title', 'Пресет графики'), h('p.gd-card-sub', 'Сколько красоты отдать ради FPS'))),
        presetSeg, presetDesc));

      /* ---------- Minecraft gray textures */
      if (isMc) {
        var dl = null;
        var grayToggle = ui.toggle({
          checked: gray, label: 'Серые текстуры',
          onChange: function (v) { gray = v; grayToggle.set(v); savePrefs(); if (dl) dl.hidden = !v; renderChecklist(); }
        });
        var mcCard = h('section.card.gd-card',
          h('div.gd-card-head', h('div.icon-tile.tone-good', ui.icon('package', null, 20)),
            h('div.grow', h('h2.gd-card-title', 'Серые текстуры'), h('p.gd-card-sub', 'Однотонные блоки — видеокарте легче, FPS выше. Руды, вода и лава не меняются.')),
            grayToggle));
        if (plat === 'android') {
          dl = ui.btn({
            label: 'Скачать пак .mcpack', icon: 'download', variant: 'soft', busyLabel: 'Собираю пак…',
            onClick: function () { return downloadPack(); }
          });
          dl.hidden = !gray;
          mcCard.appendChild(h('div.gd-row', dl, h('span.gd-hint', 'Файл сохранится в «Загрузки», Minecraft импортирует его сам')));
        }
        left.appendChild(mcCard);
      }

      /* ---------- PC profile */
      if (plat === 'windows' && game.pc && game.pc.profile && host.has('games.profile')) {
        var written = h('div.written', { hidden: true });
        var profCard = h('section.card.gd-card',
          h('div.gd-card-head', h('div.icon-tile.tone-violet', ui.icon('wrench', null, 20)),
            h('div', h('h2.gd-card-title', 'Профиль игры'), h('p.gd-card-sub', 'GinN сам пропишет пресет и лимит FPS в файлы настроек игры и сохранит копию старых.'))));
        if (installed) {
          profCard.appendChild(h('div.gd-row',
            ui.btn({
              label: 'Применить профиль', icon: 'check', variant: 'primary', busyLabel: 'Применяю…',
              onClick: function () {
                return host.applyGameProfile({ gameId: game.id, fps: fps, preset: preset, grayTextures: isMc && gray }).then(function (r) {
                  ui.toast((r && r.message) || 'Профиль применён', { tone: 'good' });
                  ui.clear(written);
                  var files = (r && r.written) || [];
                  if (files.length) {
                    written.appendChild(h('div.written-title', 'Изменены файлы:'));
                    files.forEach(function (f) { written.appendChild(h('code.written-file', f)); });
                    written.hidden = false;
                  }
                }, app.handleError);
              }
            }),
            ui.btn({
              label: 'Откатить профиль', icon: 'rotate-ccw', variant: 'ghost', busyLabel: 'Откатываю…',
              onClick: function () {
                return host.revertGameProfile({ gameId: game.id }).then(function (r) {
                  written.hidden = true;
                  ui.toast((r && r.message) || 'Настройки игры возвращены', { tone: 'good' });
                }, function (e) { ui.toast(e.message, { tone: e.code === 'NOT_FOUND' ? 'info' : 'bad' }); });
              }
            })));
          profCard.appendChild(written);
        } else {
          profCard.appendChild(h('p.gd-hint', 'Игра не найдена на этом компьютере — профиль можно применить после установки. Пока выставь настройки по списку.'));
        }
        left.appendChild(profCard);
      }

      /* ---------- checklist */
      var progLabel = h('span.ck-count');
      var progBar = ui.bar(0, 'grad');
      var ckList = h('div.ck-sections');
      var copyBtn = ui.btn({ label: 'Скопировать список', icon: 'copy', variant: 'ghost', size: 'sm', onClick: function () { return copyList(); } });
      var resetBtn = ui.btn({ label: 'Сбросить', icon: 'rotate-ccw', variant: 'plain', size: 'sm', onClick: function () { saveChecks({}); renderChecklist(); } });
      right.appendChild(h('section.card.gd-card.ck-card',
        h('div.gd-card-head', h('div.icon-tile.tone-cyan', ui.icon('list-checks', null, 20)),
          h('div.grow', h('h2.gd-card-title', 'Настройки в игре'), h('p.gd-card-sub', plat === 'android' ? 'Android не даёт менять настройки других игр — пройди по списку сам' : 'Отмечай, что уже выставил'))),
        h('div.ck-progress', progBar, progLabel),
        ckList,
        h('div.ck-foot', copyBtn, resetBtn)));

      function ckKey() { return 'check.' + plat + '.' + game.id + '.' + preset + '.' + fps; }
      function loadChecks() { var v = G.store.get(ckKey(), {}); return v && typeof v === 'object' ? v : {}; }
      function saveChecks(v) { G.store.set(ckKey(), v); }
      function currentRecipe() {
        var rec = G.games.recipe(game, plat, preset, fps) || [];
        if (isMc && !gray) {
          rec = rec.filter(function (s) { return !/GinN Gray/i.test(s.section); }).map(function (s) {
            return { section: s.section, items: s.items.filter(function (i) { return !/GinN Gray/i.test(i); }) };
          }).filter(function (s) { return s.items.length; });
        }
        return rec;
      }
      function renderChecklist() {
        var rec = currentRecipe();
        var checks = loadChecks();
        ui.clear(ckList);
        var total = 0, done = 0;
        function upd() {
          progLabel.textContent = done + ' из ' + total;
          progBar.set(total ? done / total * 100 : 0, done === total && total ? 'good' : 'grad');
        }
        if (!rec.length) {
          ckList.appendChild(h('p.gd-hint', 'Для этой платформы рецепта нет.'));
        }
        rec.forEach(function (s, si) {
          var items = s.items.map(function (txt, ii) {
            var k = si + ':' + ii + ':' + txt;
            var on = !!checks[k];
            total++; if (on) done++;
            var cb = h('input.ck-input', { type: 'checkbox', checked: on });
            var row = h('label', { class: ['ck-item', on ? 'is-done' : null] }, cb, h('span.ck-box', { html: G.icon('check', { size: 14, stroke: 3 }) }), h('span.ck-text', txt));
            cb.addEventListener('change', function () {
              var c = loadChecks();
              if (cb.checked) { c[k] = 1; done++; } else { delete c[k]; done--; }
              row.classList.toggle('is-done', cb.checked);
              saveChecks(c);
              upd();
            });
            return row;
          });
          ckList.appendChild(h('div.ck-section', h('div.ck-section-title', s.section), items));
        });
        upd();
      }
      renderChecklist();

      function copyList() {
        var rec = currentRecipe();
        var lines = ['GinN · ' + game.name + ' — «' + G.games.presets[preset].title + '», ' + (fps >= 1000 ? 'без лимита FPS' : fps + ' FPS'), ''];
        rec.forEach(function (s) {
          lines.push(s.section);
          s.items.forEach(function (i) { lines.push('• ' + i); });
          lines.push('');
        });
        return host.copyText({ text: lines.join('\n').trim() }).then(function () {
          ui.toast('Список скопирован', { tone: 'good' });
        }, app.handleError);
      }

      function downloadPack() {
        return G.mcpack.build({}).then(function (bytes) {
          return host.saveFile({ name: 'GinN-Gray.mcpack', base64: G.mcpack.toBase64(bytes), mime: 'application/octet-stream', open: true });
        }).then(function (r) {
          ui.toast('Пак сохранён' + (r && r.path ? ': ' + r.path : '') + '. Открой его — Minecraft импортирует текстуры.', { tone: 'good' });
        }, app.handleError);
      }
    }

    return {
      back: back,
      unmount: function () { alive = false; }
    };
  }
})(window.GinN);
