/* GinN — Настройки: about, restore point, revert all, system report, quick links to system screens, honest notes. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  G.pages = G.pages || {};

  var LINKS = {
    android: [
      { target: 'developer', title: 'Для разработчиков', sub: 'Анимации, фоновые процессы', icon: 'code' },
      { target: 'battery_saver', title: 'Экономия заряда', sub: 'Выключи перед игрой', icon: 'battery' },
      { target: 'display', title: 'Экран', sub: 'Частота обновления', icon: 'sun' },
      { target: 'storage', title: 'Хранилище', sub: 'Освободить место', icon: 'hard-drive' }
    ],
    windows: [
      { target: 'graphics', title: 'Настройки графики', sub: 'Видеокарта для игр', icon: 'gpu' },
      { target: 'gamemode', title: 'Игровой режим', sub: 'Параметры Windows', icon: 'gamepad' },
      { target: 'power', title: 'Электропитание', sub: 'Схемы питания', icon: 'power' },
      { target: 'startup', title: 'Автозагрузка', sub: 'Что стартует с Windows', icon: 'rocket' },
      { target: 'storage', title: 'Память', sub: 'Контроль памяти', icon: 'hard-drive' }
    ]
  };

  var NOTES = {
    android: {
      can: ['Освобождает ОЗУ перед игрой (Android 10–13 — новее система не разрешает)', 'Включает «Не беспокоить» на время игры', 'Считает потолок FPS по экрану, железу и игре', 'Собирает серые текстуры для Minecraft', 'Составляет личный план с ИИ — с твоим ключом Claude'],
      cannot: ['Менять системные настройки за тебя — GinN открывает нужный экран', 'Менять настройки внутри других игр — только по списку', 'Показывать загрузку процессора — Android её скрывает']
    },
    windows: {
      can: ['Включает твики Windows: питание, игровой режим, сеть, ввод', 'Пишет профили графики в файлы игр — с резервной копией', 'Чистит временные файлы и кэш DNS', 'Составляет личный план с ИИ — с твоим ключом Claude', 'Откатывает всё, что менял'],
      cannot: ['Разгонять процессор или видеокарту', 'Обещать «+200% FPS» — прирост зависит от игры и железа', 'Менять часть параметров без прав администратора']
    }
  };

  G.pages.settings = {
    title: 'Настройки',
    mount: function (root, ctx) {
      var ui = G.ui, h = ui.h, app = ctx.app, fmt = G.fmt, host = G.host;
      var alive = true;
      var plat = app.platform;
      var info = app.info || {};
      var win = plat === 'windows';

      root.appendChild(ui.pageHead({ title: 'Настройки', sub: 'О программе, откат изменений и системные экраны' }));

      /* ---------- about */
      var osLine = h('span', '…');
      var about = h('section.card.about',
        h('div.about-glow', { 'aria-hidden': 'true' }),
        h('img.about-logo', { src: 'assets/logo.svg', alt: '', width: 64, height: 64, draggable: 'false' }),
        h('div.about-text',
          h('div.about-name', h('span.brand-word', 'GinN'), h('span.about-ver', 'версия ' + (info.appVersion || G.version))),
          h('div.about-tag', 'Оптимизатор игр для телефона и ПК'),
          h('div.about-badges',
            ui.badge(win ? 'Windows' : info.platform === 'android' ? 'Android' : 'Браузер', 'violet', win ? 'monitor' : 'smartphone'),
            win ? (info.isAdmin ? ui.badge('Права администратора', 'good', 'shield-check') : ui.badge('Без прав администратора', 'muted', 'shield')) : null,
            host.demo ? ui.badge('Демо-режим', 'warn') : null),
          h('div.about-os', osLine)));
      app.hardware().then(function (hw) {
        if (!alive) return;
        osLine.textContent = [hw.device && hw.device.name, hw.os && hw.os.name].filter(Boolean).join(' · ');
      }, function () { osLine.textContent = ''; });

      /* ---------- actions */
      function row(o) {
        return h('div.set-row',
          h('div', { class: ['icon-tile', 'tone-' + (o.tone || 'violet')] }, ui.icon(o.icon, null, 20)),
          h('div.set-text', h('div.set-title', o.title), h('div.set-sub', o.sub)),
          o.control);
      }
      var rows = [];
      rows.push(h('a', { class: 'set-row set-link mobile-only', href: '#/monitor' },
        h('div.icon-tile.tone-good', ui.icon('activity', null, 20)),
        h('div.set-text', h('div.set-title', 'Мониторинг'), h('div.set-sub', 'Живые графики процессора, памяти и температуры')),
        ui.icon('chevron-right', 'set-go', 18)));
      if (win) {
        rows.push(row({
          icon: 'history', tone: 'cyan', title: 'Создать точку восстановления',
          sub: 'Снимок системы: если что-то пойдёт не так, Windows откатится к нему. Нужны права администратора.',
          control: ui.btn({ label: 'Создать', variant: 'soft', size: 'sm', busyLabel: 'Создаю…', onClick: restorePoint })
        }));
      }
      rows.push(row({
        icon: 'rotate-ccw', tone: 'bad', title: 'Откатить все изменения',
        sub: 'Вернуть всё, что менял GinN: настройки системы и профили игр.',
        control: ui.btn({ label: 'Откатить', variant: 'danger', size: 'sm', onClick: function () { return app.revertAll(); } })
      }));
      rows.push(row({
        icon: 'file-text', tone: 'violet', title: 'Скопировать отчёт о системе',
        sub: 'Железо, класс устройства и состояние оптимизации — удобно отправить другу или в поддержку.',
        control: ui.btn({ label: 'Скопировать', icon: 'copy', variant: 'ghost', size: 'sm', onClick: copyReport })
      }));
      if (win && app.notAdmin()) {
        rows.push(row({
          icon: 'shield', tone: 'warn', title: 'Перезапустить от администратора',
          sub: 'Нужно для твиков с пометкой «Админ» и точки восстановления.',
          control: ui.btn({ label: 'Перезапустить', variant: 'soft', size: 'sm', onClick: function () { return app.promptAdmin(); } })
        }));
      }
      var actions = h('section.card.set-card', h('h2.set-card-title', 'Действия'), h('div.set-rows', rows));

      /* ---------- quick links */
      var links = h('section.card.set-card',
        h('h2.set-card-title', win ? 'Параметры Windows' : 'Настройки телефона'),
        h('p.set-card-sub', 'Быстрый переход к системным экранам, которые влияют на игры'),
        h('div.qlinks', (LINKS[win ? 'windows' : 'android']).map(function (l) {
          return h('button', {
            type: 'button', class: 'qlink',
            onClick: function () { host.openSettings({ target: l.target }).then(function () { ui.toast('Открыто: ' + l.title, { tone: 'info' }); }, app.handleError); }
          }, h('span.qlink-ico', ui.icon(l.icon, null, 20)), h('span.qlink-text', h('span.qlink-title', l.title), h('span.qlink-sub', l.sub)), ui.icon('external-link', 'qlink-go', 16));
        })));

      /* ---------- honest notes */
      var n = NOTES[win ? 'windows' : 'android'];
      var notes = h('section.card.set-card',
        h('h2.set-card-title', 'Честно о возможностях'),
        h('div.honest',
          h('div.honest-col', h('div.honest-head.tone-good', ui.icon('check-circle', null, 16), 'GinN умеет'),
            h('ul', n.can.map(function (t) { return h('li', t); }))),
          h('div.honest-col', h('div.honest-head.tone-muted', ui.icon('x-circle', null, 16), 'GinN не может'),
            h('ul', n.cannot.map(function (t) { return h('li', t); })))),
        host.demo ? h('p.demo-note', ui.icon('alert', null, 16), h('span', 'Сейчас открыт демо-режим в браузере: данные выдуманы, а в системе ничего не меняется.')) : null);

      /* ---------- GinN AI */
      var aiBody = h('div.set-ai-body', ui.skeleton({ h: 16, w: '50%' }), ui.skeleton({ h: 120 }));
      var aiBadge = h('span.set-ai-badge');
      var aiCard = h('section.card.set-card.set-ai',
        h('div.set-ai-head', h('span.ai-promo-ico', ui.icon('sparkles', null, 20)),
          h('div.grow', h('h2.set-card-title', 'GinN AI'), h('p.set-card-sub', 'ИИ-помощник на базе Claude от Anthropic')), aiBadge),
        aiBody);
      function renderAi() {
        if (!G.ai || !G.aiUi) {
          ui.clear(aiBody);
          aiBody.appendChild(h('p.set-sub', 'Модуль ИИ не загрузился. Обнови GinN.'));
          return;
        }
        G.ai.status().then(function (st) {
          if (!alive) return;
          G.aiUi.setStatus(st);
          ui.clear(aiBody); ui.clear(aiBadge);
          if (st.available === false) {
            aiBadge.appendChild(ui.badge('Недоступно', 'muted'));
            aiBody.appendChild(h('p.set-sub', (st.error && st.error.message) || 'Эта версия приложения не поддерживает ИИ.'));
            return;
          }
          aiBadge.appendChild(st.transport === 'mock' ? ui.badge('Демо', 'warn') : st.configured ? ui.badge('Ключ добавлен', 'good', 'check') : ui.badge('Нет ключа', 'muted', 'key'));
          var picker = G.aiUi.modelPicker(st.model, function (id) {
            G.ai.configure({ model: id }).then(function (s2) {
              G.aiUi.setStatus(s2);
              ui.toast('Модель: ' + G.aiUi.modelName(id), { tone: 'good' });
              G.bus.emit('ui:ai', s2);
            }, function (e) { ui.toast(e.message, { tone: 'bad' }); picker.setValue(st.model); });
          });
          var keyBtns = h('div.set-ai-btns',
            ui.btn({ label: st.configured ? 'Изменить ключ' : 'Добавить ключ', icon: 'key', variant: st.configured ? 'ghost' : 'soft', size: 'sm', onClick: function () { G.aiUi.openKeyEditor({ focusKey: true }); } }),
            st.configured && st.transport !== 'mock' ? ui.btn({ label: 'Удалить', icon: 'trash', variant: 'danger', size: 'sm', onClick: function () { return G.aiUi.removeKey(); } }) : null);
          aiBody.appendChild(h('div.ai-label', 'Модель'));
          aiBody.appendChild(picker);
          aiBody.appendChild(h('div.set-row.set-ai-key',
            h('div.icon-tile.tone-violet', ui.icon('key', null, 20)),
            h('div.set-text', h('div.set-title', 'Ключ Claude API'),
              h('div.set-sub', st.transport === 'mock' ? 'Демо-режим: ключ не нужен, запросы к Claude не отправляются.'
                : st.configured ? (st.transport === 'native' ? 'Хранится в зашифрованном виде на этом компьютере.' : 'Хранится только на этом устройстве.')
                  : 'Без ключа доступен только базовый анализ по правилам.')),
            keyBtns));
          aiBody.appendChild(h('p.ai-fine', ui.icon('shield', null, 14),
            h('span', 'ИИ видит характеристики устройства и список оптимизаций, но не твои файлы и не имя устройства. Запросы оплачивает владелец ключа.')));
        });
      }
      renderAi();
      var offAi = G.bus.on('ui:ai', function () { renderAi(); });

      root.appendChild(h('div.set-grid', h('div.set-col', about, aiCard, actions), h('div.set-col', links, notes)));

      function restorePoint() {
        var t = (app.lastTweaks || []).filter(function (x) { return x.id === 'restore_point'; })[0] ||
          { id: 'restore_point', kind: 'action', title: 'Точка восстановления', requiresAdmin: true };
        if (t.requiresAdmin && app.notAdmin()) { app.promptAdmin('Точку восстановления может создать только администратор.'); return null; }
        return app.applyTweak(t, true).then(function (r) {
          if (r) ui.toast(r.message || 'Точка восстановления создана', { tone: 'good' });
        });
      }

      function copyReport() {
        return Promise.all([app.hardware(), app.tweaks().catch(function () { return null; })]).then(function (r) {
          var hw = r[0], tw = r[1];
          var d = G.devices;
          var cls = app.classify(hw);
          var cpu = hw.cpu || {}, ram = hw.ram || {}, s = hw.storage || {}, disp = hw.display || {}, b = hw.battery;
          var lines = ['GinN ' + (info.appVersion || G.version) + ' — отчёт о системе', ''];
          lines.push('Устройство: ' + ((hw.device && hw.device.name) || '—') + (hw.device && hw.device.model && hw.device.model !== hw.device.name ? ' (' + hw.device.model + ')' : ''));
          lines.push('Система: ' + ((hw.os && hw.os.name) || '—') + (hw.os && hw.os.build ? ', сборка ' + hw.os.build : ''));
          var cpuParts = [d.prettyCpu(cpu) || cpu.name || '—'];
          if (cpu.cores) cpuParts.push(fmt.count(cpu.cores, 'ядро', 'ядра', 'ядер'));
          if (cpu.threads && cpu.threads !== cpu.cores) cpuParts.push(fmt.count(cpu.threads, 'поток', 'потока', 'потоков'));
          if (cpu.maxMHz) cpuParts.push('до ' + fmt.mhz(cpu.maxMHz));
          lines.push('Процессор: ' + cpuParts.join(', '));
          lines.push('Видеокарта: ' + (app.gpuName(hw) || 'неизвестно') + (hw.gpu && hw.gpu.vramMB ? ', ' + fmt.mb(hw.gpu.vramMB) : ''));
          lines.push('ОЗУ: ' + fmt.mb(ram.totalMB) + ' (свободно ' + fmt.mb(ram.availMB) + ')');
          lines.push('Память: свободно ' + fmt.gb(s.freeGB) + ' из ' + fmt.gb(s.totalGB) + (s.type ? ' (' + s.type + ')' : ''));
          lines.push('Экран: ' + (disp.width ? disp.width + ' × ' + disp.height + ', ' : '') + fmt.hz(disp.refreshHz) + (disp.maxRefreshHz > disp.refreshHz ? ' (до ' + fmt.hz(disp.maxRefreshHz) + ')' : ''));
          if (b && b.present !== false) lines.push('Батарея: ' + fmt.pct(b.level) + (b.tempC != null ? ', ' + fmt.temp(b.tempC) : '') + (b.charging ? ', заряжается' : ''));
          lines.push('Класс устройства: ' + cls.tierName + ' (оценка ' + cls.score + '/100)');
          if (tw) {
            var st = app.optState(tw);
            lines.push('Оптимизация: ' + st.pct + '% (' + st.done + ' из ' + st.total + ')');
          }
          if (host.demo) lines.push('', 'Демо-режим: данные не настоящие.');
          return host.copyText({ text: lines.join('\n') });
        }).then(function () { ui.toast('Отчёт скопирован', { tone: 'good' }); }, app.handleError);
      }

      return {
        unmount: function () { alive = false; offAi(); },
        refresh: function () { renderAi(); }
      };
    }
  };
})(window.GinN);
