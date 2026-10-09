/* GinN — Оптимизация: tweak list with category filter, toggles / actions / links, admin + reboot banners. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  G.pages = G.pages || {};

  var GENERIC = /^(включено|выключено|готово)\.?$/i;

  G.pages.optimize = {
    title: 'Оптимизация',
    mount: function (root, ctx) {
      var ui = G.ui, h = ui.h, app = ctx.app, fmt = G.fmt;
      var alive = true;
      var offs = [];
      var tweaks = null;
      var cards = {};
      var cat = G.store.get('optimize.cat', 'all');

      var sub = h('p.page-sub', 'Проверяю систему…');
      var runAll = ui.btn({ label: 'Оптимизировать всё', icon: 'zap', variant: 'primary', cls: 'btn-glow', busyLabel: 'Оптимизирую…', onClick: function () { return app.optimizeAll(); } });
      var revert = ui.btn({ label: 'Откатить', icon: 'rotate-ccw', variant: 'ghost', onClick: function () { return app.revertAll(); } });
      var head = h('header.page-head', h('div.page-head-row',
        h('div.page-head-text', h('h1.page-title', 'Оптимизация'), sub),
        h('div.page-actions', revert, runAll)));
      var banners = h('div.banners');
      var chips = h('div.chips', { role: 'toolbar', 'aria-label': 'Категории' });
      var list = h('div.tweak-list', [0, 1, 2, 3].map(function () {
        return h('div.card.tweak.is-sk', h('div.tw-top', ui.skeleton({ h: 40, w: '40px' }), h('div.grow', ui.skeleton({ h: 16, w: '60%' }), ui.skeleton({ h: 12, w: '30%' })), ui.skeleton({ h: 28, w: '48px' })), ui.skeleton({ h: 12 }), ui.skeleton({ h: 12, w: '70%' }));
      }));
      root.appendChild(head);
      root.appendChild(banners);
      root.appendChild(chips);
      root.appendChild(list);

      /* ---------------- banners */
      function banner(o) {
        return h('div', { class: ['banner', 'banner-' + (o.tone || 'info')], role: o.tone === 'warn' ? 'alert' : null },
          h('div.banner-ico', ui.icon(o.icon || 'info', null, 20)),
          h('div.banner-text', h('div.banner-title', o.title), o.text ? h('div.banner-sub', o.text) : null),
          o.action || null);
      }
      function renderBanners() {
        ui.clear(banners);
        if (!tweaks) return;
        if (app.notAdmin() && tweaks.some(function (t) { return t.requiresAdmin; })) {
          banners.appendChild(banner({
            tone: 'warn', icon: 'shield', title: 'Часть твиков требует прав администратора',
            text: 'Без них Windows не даст изменить системные параметры. Пункты с пометкой «Админ» заработают после перезапуска.',
            action: ui.btn({ label: 'Перезапустить от администратора', icon: 'shield', variant: 'soft', size: 'sm', onClick: function () { return app.promptAdmin(); } })
          }));
        }
        if (app.rebootNeeded) {
          banners.appendChild(banner({
            tone: 'info', icon: 'rotate-ccw', title: 'Нужна перезагрузка',
            text: 'Часть изменений заработает после перезагрузки компьютера.',
            action: ui.btn({ label: 'Понятно', variant: 'ghost', size: 'sm', onClick: function () { app.setReboot(false); } })
          }));
        }
        if (app.platform === 'android') {
          banners.appendChild(banner({
            tone: 'muted', icon: 'info', title: 'Android не даёт приложениям менять системные настройки',
            text: 'Кнопка «Открыть» ведёт прямо на нужный экран — переключи там, а GinN проверит результат, когда вернёшься.'
          }));
        }
      }

      /* ---------------- chips */
      function renderChips() {
        ui.clear(chips);
        var present = {};
        tweaks.forEach(function (t) { present[t.category] = (present[t.category] || 0) + 1; });
        var cats = app.CATEGORY_ORDER.filter(function (c) { return present[c]; });
        Object.keys(present).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
        if (cat !== 'all' && !present[cat]) cat = 'all';
        var all = [{ id: 'all', title: 'Все', count: tweaks.length }].concat(cats.map(function (c) {
          return { id: c, title: (app.CATEGORY[c] || { title: c }).title, count: present[c] };
        }));
        all.forEach(function (c) {
          chips.appendChild(ui.chip({
            label: c.title, count: c.count, active: cat === c.id,
            onClick: function () {
              cat = c.id;
              G.store.set('optimize.cat', cat);
              ui.$$('.chip', chips).forEach(function (el, i) { el.setActive(all[i].id === cat); });
              renderList();
            }
          }));
        });
      }

      /* ---------------- tweak card */
      function catInfo(t) { return app.CATEGORY[t.category] || { title: t.category, icon: 'sliders' }; }
      var TONE = { power: 'violet', graphics: 'cyan', system: 'violet', input: 'cyan', network: 'cyan', cleanup: 'good', android: 'violet' };

      function tweakCard(t) {
        var c = catInfo(t);
        var msg = h('div.tw-msg', { hidden: true, 'aria-live': 'polite' });
        var stateSlot = h('span.tw-state');
        var badges = [];
        if (t.recommended) badges.push(ui.badge('Рекомендуется', 'good', 'star'));
        if (t.requiresAdmin) badges.push(ui.badge('Админ', app.notAdmin() ? 'warn' : 'violet', 'shield'));
        if (t.requiresReboot) badges.push(ui.badge('Перезагрузка', 'cyan', 'rotate-ccw'));
        if (t.risk === 'moderate') badges.push(ui.badge('Осторожно', 'warn', 'alert'));
        var tags = (t.impact || []).map(function (k) { return h('span.tag', app.IMPACT[k] || k); });

        var toggleEl = null, actBtn = null;
        if (t.kind === 'toggle') {
          toggleEl = ui.toggle({ checked: t.state === 'on', label: t.title, onChange: function (next) { onToggle(t, next); } });
        } else if (t.kind === 'action') {
          actBtn = ui.btn({ label: 'Запустить', icon: 'play', variant: 'soft', size: 'sm', busyLabel: 'Выполняю…', onClick: function () { return onAction(t); } });
        } else {
          actBtn = ui.btn({ label: 'Открыть', icon: 'external-link', variant: 'ghost', size: 'sm', onClick: function () { return onLink(t); } });
        }

        var el = h('article', { class: ['card', 'tweak', 'kind-' + t.kind], dataset: { id: t.id } },
          h('div.tw-top',
            h('div', { class: ['icon-tile', 'tone-' + (TONE[t.category] || 'violet')] }, ui.icon(c.icon, null, 22)),
            h('div.tw-head', h('h3.tw-title', t.title), badges.length ? h('div.tw-badges', badges) : null),
            toggleEl ? h('div.tw-control', toggleEl) : null),
          h('p.tw-desc', t.desc),
          h('div.tw-foot', h('div.tw-tags', tags), stateSlot, actBtn),
          msg);

        var api = {
          el: el,
          update: function (nt) {
            t = nt;
            if (toggleEl) toggleEl.set(t.state === 'on');
            ui.clear(stateSlot);
            el.classList.toggle('is-on', t.state === 'on');
            if (t.kind === 'link') {
              if (t.state === 'on') stateSlot.appendChild(ui.badge('Готово', 'good', 'check'));
              else if (t.state === 'off') stateSlot.appendChild(ui.badge('Можно лучше', 'warn'));
            } else if (t.kind === 'action') {
              if (t.state === 'on' || app.ranActions[t.id]) stateSlot.appendChild(ui.badge('Сделано', 'good', 'check'));
            } else if (t.state === 'unknown') {
              stateSlot.appendChild(ui.badge('Состояние неизвестно', 'muted'));
            }
          },
          message: function (text, tone) {
            ui.clear(msg);
            if (!text) { msg.hidden = true; return; }
            msg.className = 'tw-msg tone-' + (tone || 'good');
            msg.appendChild(ui.icon(tone === 'warn' ? 'alert' : tone === 'bad' ? 'alert-circle' : 'check-circle', null, 16));
            msg.appendChild(h('span', text));
            msg.hidden = false;
          },
          toggle: toggleEl
        };
        api.update(t);
        return api;
      }

      function needAdmin(t) {
        if (t.requiresAdmin && app.notAdmin()) {
          app.promptAdmin('«' + t.title + '» меняет системные параметры Windows.');
          return true;
        }
        return false;
      }

      function afterApply(t, r) {
        var card = cards[t.id];
        if (!card) return;
        card.update(t);
        if (r && r.message && !GENERIC.test(r.message)) card.message(r.message, r.needsReboot ? 'warn' : 'good');
        else card.message(null);
        renderBanners();
        updateSub();
      }

      function onToggle(t, next) {
        var card = cards[t.id];
        if (needAdmin(t)) { card.toggle.set(t.state === 'on'); return; }
        var go = Promise.resolve(true);
        if (next && t.risk === 'moderate') {
          go = ui.confirm({ title: 'Включить «' + t.title + '»?', text: t.desc + ' Если что-то пойдёт не так, выключи его здесь же.', ok: 'Включить', icon: 'alert' });
        }
        go.then(function (yes) {
          if (!yes) { card.toggle.set(t.state === 'on'); return; }
          card.toggle.busy(true);
          card.toggle.set(next);
          app.applyTweak(t, next).then(function (r) {
            if (!alive) return;
            card.toggle.busy(false);
            card.toggle.set(t.state === 'on');
            if (r) afterApply(t, r);
          });
        });
      }

      function onAction(t) {
        if (needAdmin(t)) return null;
        return app.applyTweak(t, true).then(function (r) {
          if (!alive || !r) return;
          afterApply(t, r);
          G.ui.toast(r.message || 'Готово', { tone: 'good' });
        });
      }

      function onLink(t) {
        return app.applyTweak(t, true).then(function (r) {
          if (!alive || !r) return;
          afterApply(t, r);
          if (r.message) G.ui.toast(r.message, { tone: 'info' });
        });
      }

      /* ---------------- list */
      function renderList() {
        ui.clear(list);
        cards = {};
        var shown = tweaks.filter(function (t) { return cat === 'all' || t.category === cat; });
        if (!shown.length) {
          list.appendChild(ui.empty({ icon: 'sliders', title: 'Здесь пусто', text: 'В этой категории нет настроек.' }));
          return;
        }
        if (cat === 'all') {
          var groups = {};
          var order = [];
          shown.forEach(function (t) {
            if (!groups[t.category]) { groups[t.category] = []; order.push(t.category); }
            groups[t.category].push(t);
          });
          order.sort(function (a, b) {
            var ia = app.CATEGORY_ORDER.indexOf(a), ib = app.CATEGORY_ORDER.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          });
          order.forEach(function (c) {
            var info = app.CATEGORY[c] || { title: c, icon: 'sliders' };
            list.appendChild(h('div.tw-group-head', ui.icon(info.icon, null, 16), h('span', info.title), h('span.tw-group-count', String(groups[c].length))));
            var grid = h('div.tw-grid');
            groups[c].forEach(function (t) { var cd = tweakCard(t); cards[t.id] = cd; grid.appendChild(cd.el); });
            list.appendChild(grid);
          });
        } else {
          var grid = h('div.tw-grid');
          shown.forEach(function (t) { var cd = tweakCard(t); cards[t.id] = cd; grid.appendChild(cd.el); });
          list.appendChild(grid);
        }
      }

      function updateSub() {
        if (!tweaks) return;
        var st = app.optState(tweaks);
        var on = tweaks.filter(function (t) { return t.state === 'on'; }).length;
        sub.textContent = fmt.count(tweaks.length, 'настройка', 'настройки', 'настроек') + ' · включено ' + on +
          ' · оптимизация ' + st.pct + '%';
      }

      function apply(listData) {
        if (!alive) return;
        var same = tweaks && listData.length === tweaks.length && listData.every(function (t, i) { return tweaks[i].id === t.id; });
        tweaks = listData;
        if (same && Object.keys(cards).length) {
          tweaks.forEach(function (t) { if (cards[t.id]) cards[t.id].update(t); });
        } else {
          renderChips();
          renderList();
        }
        renderBanners();
        updateSub();
      }

      function load(force) {
        app.tweaks(force).then(apply, function (e) {
          if (!alive) return;
          ui.clear(list);
          list.appendChild(h('div.card', ui.errorState(e, function () { load(true); })));
          sub.textContent = 'Не удалось получить список настроек';
        });
      }

      offs.push(G.bus.on('ui:tweaks', apply));
      offs.push(G.bus.on('ui:reboot', function () { renderBanners(); }));
      load(false);

      return {
        unmount: function () { alive = false; offs.forEach(function (f) { f(); }); },
        refresh: function () { /* app re-fetches tweaks on resume; 'ui:tweaks' updates the cards */ }
      };
    }
  };
})(window.GinN);
