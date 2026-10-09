/* GinN — Мониторинг: live tiles with canvas sparklines (60 points ≈ 90 s). Polling pauses when hidden or off-route. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  G.pages = G.pages || {};

  /** '41 °C' -> ['41', '°C'], '42%' -> ['42', '%'] */
  function split(s) {
    s = String(s);
    if (/%$/.test(s)) return [s.slice(0, -1), '%'];
    var i = s.lastIndexOf(' ');
    return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ''];
  }

  function avgPeak(arr) {
    var v = arr.filter(function (x) { return typeof x === 'number'; });
    if (!v.length) return null;
    var sum = 0, mx = -Infinity;
    v.forEach(function (x) { sum += x; if (x > mx) mx = x; });
    return { avg: sum / v.length, peak: mx };
  }

  G.pages.monitor = {
    title: 'Мониторинг',
    mount: function (root, ctx) {
      var ui = G.ui, h = ui.h, app = ctx.app, fmt = G.fmt;
      var alive = true;
      var hw = null;
      var tiles = {};
      var order = [];
      var thermalSlot = h('div.mon-thermal');
      var note = h('div.mon-note', { hidden: true });

      root.appendChild(h('button', { type: 'button', class: 'back-link mobile-only', onClick: function () { app.go('dashboard'); } },
        ui.icon('chevron-left', null, 18), h('span', 'Главная')));
      root.appendChild(h('header.page-head', h('div.page-head-row',
        h('div.page-head-text', h('h1.page-title', 'Мониторинг'),
          h('p.page-sub.mon-live', h('span.live-dot'), h('span', 'Обновляется каждые 1,5 с · последние 90 секунд'))),
        h('div.page-actions', thermalSlot))));
      var grid = h('div.mon-grid', [0, 1, 2, 3].map(function () {
        return h('div.card.mon-tile.is-sk', h('div.mon-head', ui.skeleton({ h: 36, w: '36px' }), ui.skeleton({ h: 14, w: '40%' })), ui.skeleton({ h: 36, w: '35%' }), ui.skeleton({ h: 72 }));
      }));
      root.appendChild(grid);
      root.appendChild(note);

      app.hardware().then(function (d) { hw = d; }, function () { /* tiles work without it */ });

      function makeTile(key, o) {
        var num = h('span.mon-num', '—');
        var unit = h('span.mon-unit');
        var label = h('div.mon-label', o.label);
        var chip = h('div.mon-chip');
        var subEl = h('div.mon-sub');
        var stat = h('div.mon-stat');
        var spark = o.noSpark ? null : ui.sparkline({ color: o.color, color2: o.color2, min: o.min, max: o.max, minSpan: o.minSpan, points: 60 });
        var wait = h('div.mon-wait', 'Собираю историю…');
        var el = h('section', { class: ['card', 'mon-tile', 'mon-' + key], style: { '--tc': o.color } },
          h('div.mon-head', h('div', { class: ['icon-tile', 'tone-' + (o.tone || 'violet')] }, ui.icon(o.icon, null, 20)), label, chip),
          h('div.mon-val', num, unit),
          subEl,
          spark ? h('div.mon-spark', spark, wait, h('div.mon-axis', h('span', '90 с назад'), h('span', 'сейчас'))) : null,
          stat);
        var t = {
          el: el, spark: spark, opts: o,
          set: function (valueStr, sub, hist, statText) {
            var p = split(valueStr);
            num.textContent = p[0];
            unit.textContent = p[1];
            subEl.textContent = sub || '';
            stat.textContent = statText || '';
            if (spark && hist) {
              spark.draw(hist);
              var n = hist.filter(function (x) { return typeof x === 'number'; }).length;
              wait.classList.toggle('is-off', n >= 8);
            }
          },
          label: function (txt) { label.textContent = txt; },
          chip: function (node) { ui.clear(chip); if (node) chip.appendChild(node); }
        };
        tiles[key] = t;
        order.push(key);
        return t;
      }

      function statLine(arr, f) {
        var ap = avgPeak(arr);
        return ap ? 'Среднее ' + f(ap.avg) + ' · пик ' + f(ap.peak) : '';
      }

      function ensureTiles(s) {
        var want = [];
        want.push(s.cpuLoad != null ? 'cpu' : 'mhz');
        want.push('ram');
        want.push('temp');
        if (s.gpuLoad != null) want.push('gpu');
        if (s.batteryLevel != null) want.push('bat');
        if (want.join() === order.join()) return;
        tiles = {}; order = [];
        ui.clear(grid);
        want.forEach(function (k) {
          var t;
          if (k === 'cpu') t = makeTile('cpu', { label: 'Загрузка процессора', icon: 'cpu', color: '#7C5CFF', color2: '#A78BFA', min: 0, max: 100, tone: 'violet' });
          if (k === 'mhz') t = makeTile('mhz', { label: 'Частота процессора', icon: 'cpu', color: '#7C5CFF', color2: '#A78BFA', min: 0, max: (hw && hw.cpu && hw.cpu.maxMHz) || null, minSpan: 200, tone: 'violet' });
          if (k === 'ram') t = makeTile('ram', { label: 'Оперативная память', icon: 'memory', color: '#22D3EE', color2: '#67E8F9', min: 0, max: 100, tone: 'cyan' });
          if (k === 'temp') t = makeTile('temp', { label: 'Температура', icon: 'thermometer', color: '#FBBF24', color2: '#F87171', minSpan: 3, tone: 'warn', noSpark: s.tempC == null });
          if (k === 'gpu') t = makeTile('gpu', { label: 'Загрузка видеокарты', icon: 'gpu', color: '#34D399', color2: '#6EE7B7', min: 0, max: 100, tone: 'good' });
          if (k === 'bat') t = makeTile('bat', { label: 'Батарея', icon: 'battery', color: '#34D399', color2: '#22D3EE', min: 0, max: 100, tone: 'good' });
          grid.appendChild(t.el);
        });
        if (s.cpuLoad == null) {
          note.hidden = false;
          ui.clear(note);
          note.appendChild(ui.icon('info', null, 16));
          note.appendChild(h('span', app.platform === 'android'
            ? 'Android не показывает приложениям загрузку процессора — вместо неё GinN показывает его частоту. Выдумывать проценты не будем.'
            : 'Система не отдаёт загрузку процессора — показываем частоту.'));
        } else note.hidden = true;
      }

      function onStats(s, hist, err) {
        if (!alive) return;
        if (!s) {
          if (err && !order.length) { ui.clear(grid); grid.appendChild(h('div.card.span-all', ui.errorState(err, null, 'Нет данных с датчиков'))); }
          return;
        }
        ensureTiles(s);
        if (tiles.cpu) tiles.cpu.set(fmt.pct(s.cpuLoad), s.cpuMHz != null ? 'Частота ' + fmt.mhz(s.cpuMHz) : '', hist.cpu, statLine(hist.cpu, function (v) { return fmt.pct(v); }));
        if (tiles.mhz) {
          var mx = hw && hw.cpu && hw.cpu.maxMHz;
          tiles.mhz.set(fmt.mhz(s.cpuMHz), mx ? 'Максимум ' + fmt.mhz(mx) + ' · ' + fmt.pct(s.cpuMHz / mx * 100) + ' от пика' : '', hist.mhz, statLine(hist.mhz, function (v) { return fmt.mhz(v); }));
        }
        if (tiles.ram) {
          var total = hw && hw.ram && hw.ram.totalMB;
          tiles.ram.set(fmt.pct(s.ramUsedPct), 'Свободно ' + fmt.mb(s.ramAvailMB) + (total ? ' из ' + fmt.mb(total) : ''), hist.ram, statLine(hist.ram, function (v) { return fmt.pct(v); }));
        }
        if (tiles.temp) {
          if (s.tempC != null) {
            tiles.temp.label(s.tempSource === 'battery' ? 'Температура батареи' : 'Температура процессора');
            tiles.temp.set(fmt.temp(s.tempC), s.tempSource === 'battery' ? 'Датчик: батарея — лучший ориентир нагрева телефона' : 'Датчик: процессор', hist.temp, statLine(hist.temp, function (v) { return fmt.temp(v); }));
          } else {
            tiles.temp.set('Нет датчика', 'Система не отдаёт температуру этому приложению', null, '');
          }
          tiles.temp.chip(ui.thermal(s));
        }
        if (tiles.gpu) tiles.gpu.set(fmt.pct(s.gpuLoad), 'Видеокарта', hist.gpu, statLine(hist.gpu, function (v) { return fmt.pct(v); }));
        if (tiles.bat) {
          var b = hw && hw.battery;
          tiles.bat.set(fmt.pct(s.batteryLevel), b ? (b.charging ? 'Заряжается' : 'Работает от батареи') : '', hist.bat, '');
        }
        ui.clear(thermalSlot);
        var th = ui.thermal(s);
        if (th) { thermalSlot.appendChild(h('span.mon-thermal-label', 'Нагрев')); thermalSlot.appendChild(th); }
      }

      var off = app.stats.subscribe(onStats);
      return {
        unmount: function () {
          alive = false;
          off();
          Object.keys(tiles).forEach(function (k) { if (tiles[k].spark && tiles[k].spark.dispose) tiles[k].spark.dispose(); });
        }
      };
    }
  };
})(window.GinN);
