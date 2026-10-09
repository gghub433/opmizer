/* GinN — shared UI components (no framework).
 * GinN.ui: h(), $, $$, icon(), btn(), toggle(), segmented(), chip(), badge(), bar(), ring(), sparkline(),
 *          card(), pageHead(), section(), skeleton(), empty(), errorState(), toast(), modal(), confirm(),
 *          closeTopModal(), hasModal(), gameTile(), hexA(), reducedMotion().
 * Also exposed as GinN.h / GinN.$ / GinN.toast / GinN.modal (contract names). */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  var doc = document;
  var seq = 0;

  /* ----------------------------------------------------------------- DOM */

  function isNode(x) { return !!x && typeof x === 'object' && typeof x.nodeType === 'number'; }
  var PROPS = { value: 1, checked: 1, disabled: 1, hidden: 1, selected: 1, tabIndex: 1, readOnly: 1, indeterminate: 1 };

  function addKids(el, kids) {
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k == null || k === false || k === true) continue;
      if (Array.isArray(k)) { addKids(el, k); continue; }
      el.appendChild(isNode(k) ? k : doc.createTextNode(String(k)));
    }
  }

  function classList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.reduce(function (acc, c) { return c ? acc.concat(classList(c)) : acc; }, []);
    if (typeof v === 'object') return Object.keys(v).filter(function (k) { return v[k]; });
    return String(v).split(/\s+/).filter(Boolean);
  }

  /**
   * h('div.card#id', {attrs}, ...children) -> Element.
   * attrs: class (string|array|{name:bool}), style (string|object, supports --vars), html, text,
   * on<Event> (function), dataset (object), value/checked/disabled… (as properties), others as attributes.
   */
  function h(sel, attrs) {
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs == null || typeof attrs !== 'object' || isNode(attrs) || Array.isArray(attrs)) {
      if (attrs != null) kids.unshift(attrs);
      attrs = null;
    }
    var m = /^([a-z0-9-]*)([^]*)$/i.exec(sel || 'div');
    var el = doc.createElement(m[1] || 'div');
    var rest = m[2] || '';
    rest.replace(/([.#])([^.#]+)/g, function (_, t, name) {
      if (t === '#') el.id = name; else el.classList.add(name);
      return '';
    });
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class' || k === 'className') { classList(v).forEach(function (c) { el.classList.add(c); }); return; }
        if (k === 'style') {
          if (typeof v === 'string') el.style.cssText += ';' + v;
          else Object.keys(v).forEach(function (p) { if (v[p] != null) el.style.setProperty(p.indexOf('-') >= 0 ? p : p.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }), String(v[p])); });
          return;
        }
        if (k === 'html') { el.innerHTML = v; return; }
        if (k === 'text') { el.textContent = v; return; }
        if (k === 'dataset') { Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; }); return; }
        if (k.length > 2 && k.slice(0, 2) === 'on' && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
          return;
        }
        if (PROPS[k]) { el[k] = v; return; }
        el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    addKids(el, kids);
    return el;
  }

  function $(sel, root) { return (root || doc).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function isDesktop() {
    try { return window.matchMedia('(min-width: 900px)').matches; } catch (e) { return window.innerWidth >= 900; }
  }

  /** '#7C5CFF' + alpha -> 'rgba(124,92,255,a)'. mix toward bg with `dark` (0..1). */
  function hexA(hex, a, dark) {
    var s = String(hex || '#7C5CFF').replace('#', '');
    if (s.length === 3) s = s.replace(/(.)/g, '$1$1');
    var n = parseInt(s, 16);
    if (!isFinite(n)) n = 0x7C5CFF;
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (dark) {
      r = Math.round(r + (7 - r) * dark); g = Math.round(g + (8 - g) * dark); b = Math.round(b + (13 - b) * dark);
    }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (a == null ? 1 : a) + ')';
  }

  /* ---------------------------------------------------------- primitives */

  function icon(name, cls, size) {
    return h('span', { class: ['ico', cls], html: G.icon(name, { size: size || 20 }), 'aria-hidden': 'true' });
  }

  function spinner(cls) { return h('span', { class: ['spinner', cls], 'aria-hidden': 'true' }); }

  /**
   * btn({label, icon, variant:'primary'|'ghost'|'soft'|'danger'|'plain', size:'sm'|'lg', block, onClick, title, type})
   * Returned element has .busy(bool, label?) and .setLabel(text).
   */
  function btn(o) {
    o = o || {};
    var lbl = h('span.btn-label', o.label || '');
    var ic = o.icon ? icon(o.icon, 'btn-ico', o.size === 'sm' ? 18 : 20) : null;
    var el = h('button', {
      type: o.type || 'button',
      class: ['btn', 'btn-' + (o.variant || 'ghost'), o.size ? 'btn-' + o.size : null, o.block ? 'btn-block' : null,
        !o.label ? 'btn-icon' : null, o.cls],
      title: o.title || null,
      'aria-label': o.ariaLabel || (!o.label ? o.title : null) || null,
      disabled: !!o.disabled
    }, ic, o.label ? lbl : null);
    var sp = null;
    var busyFlag = false;
    el.busy = function (on, text) {
      busyFlag = !!on;
      el.disabled = busyFlag;
      el.classList.toggle('is-busy', busyFlag);
      el.setAttribute('aria-busy', busyFlag ? 'true' : 'false');
      if (busyFlag) {
        if (!sp) { sp = spinner('btn-spin'); el.insertBefore(sp, el.firstChild); }
        if (ic) ic.style.display = 'none';
        if (text) { el._prev = lbl.textContent; lbl.textContent = text; }
      } else {
        if (sp) { sp.remove(); sp = null; }
        if (ic) ic.style.display = '';
        if (el._prev != null) { lbl.textContent = el._prev; el._prev = null; }
      }
    };
    el.isBusy = function () { return busyFlag; };
    el.setLabel = function (t) { lbl.textContent = t; };
    if (o.onClick) {
      el.addEventListener('click', function (ev) {
        if (busyFlag) return;
        var r = o.onClick(ev, el);
        if (r && typeof r.then === 'function') {
          el.busy(true, o.busyLabel);
          r.then(function () { el.busy(false); }, function () { el.busy(false); });
        }
      });
    }
    return el;
  }

  /** badge(text, tone, icon?) tone: violet|cyan|good|warn|bad|muted|grad */
  function badge(text, tone, ic) {
    return h('span', { class: ['badge', 'badge-' + (tone || 'muted')] }, ic ? icon(ic, 'badge-ico', 14) : null, text);
  }

  /** chip({label, active, onClick, count}) -> button.chip */
  function chip(o) {
    var el = h('button', {
      type: 'button', class: ['chip', o.active ? 'is-active' : null], 'aria-pressed': o.active ? 'true' : 'false',
      onClick: function () { if (o.onClick) o.onClick(); }
    }, o.icon ? icon(o.icon, 'chip-ico', 16) : null, h('span', o.label), o.count != null ? h('span.chip-count', String(o.count)) : null);
    el.setActive = function (on) { el.classList.toggle('is-active', !!on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    return el;
  }

  /** toggle({checked, label, onChange(next)}) -> button[role=switch] with .set(bool) / .busy(bool) */
  function toggle(o) {
    o = o || {};
    var checked = !!o.checked;
    var el = h('button', {
      type: 'button', role: 'switch', class: 'switch', 'aria-checked': checked ? 'true' : 'false',
      'aria-label': o.label || null, disabled: !!o.disabled
    }, h('span.switch-track', h('span.switch-knob', spinner('switch-spin'))));
    el.set = function (v) { checked = !!v; el.setAttribute('aria-checked', checked ? 'true' : 'false'); };
    el.get = function () { return checked; };
    el.busy = function (on) { el.classList.toggle('is-busy', !!on); el.disabled = !!on; };
    el.addEventListener('click', function () {
      if (el.disabled) return;
      if (o.onChange) o.onChange(!checked, el); else el.set(!checked);
    });
    return el;
  }

  /**
   * segmented({options:[{value,label,sub?,mark?}], value, onChange, pills, ariaLabel}) -> div[role=radiogroup]
   * .setValue(v)
   */
  function segmented(o) {
    var val = o.value;
    var btns = [];
    var el = h('div', { class: ['seg', o.pills ? 'seg-pills' : null, o.cls], role: 'radiogroup', 'aria-label': o.ariaLabel || null });
    o.options.forEach(function (op, i) {
      var b = h('button', {
        type: 'button', role: 'radio', class: ['seg-opt', op.mark ? 'has-mark' : null],
        'aria-checked': op.value === val ? 'true' : 'false', tabIndex: op.value === val ? 0 : -1,
        onClick: function () { pick(op.value, true); },
        onKeydown: function (ev) {
          var d = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
          if (!d) return;
          ev.preventDefault();
          var n = o.options[(i + d + o.options.length) % o.options.length];
          pick(n.value, true);
          btns[o.options.indexOf(n)].focus();
        }
      }, h('span.seg-label', op.label), op.sub ? h('span.seg-sub', op.sub) : null, op.mark ? h('span.seg-mark', { title: op.markTitle || '' }) : null);
      btns.push(b);
      el.appendChild(b);
    });
    function pick(v, user) {
      val = v;
      btns.forEach(function (b, i) {
        var on = o.options[i].value === v;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      if (user && o.onChange) o.onChange(v);
    }
    el.setValue = function (v) { pick(v, false); };
    return el;
  }

  /** bar(pct, tone) -> .bar with .set(pct, tone?) */
  function bar(pct, tone) {
    var fill = h('span.bar-fill');
    var el = h('div', { class: ['bar', tone ? 'bar-' + tone : null], role: 'presentation' }, fill);
    el.set = function (p, t) {
      var v = Math.max(0, Math.min(100, Number(p) || 0));
      fill.style.width = v + '%';
      if (t !== undefined) {
        el.className = 'bar' + (t ? ' bar-' + t : '');
      }
    };
    el.set(pct);
    return el;
  }

  /* --------------------------------------------------------- ring gauge */

  /**
   * ring({value, label, size}) -> .ring element with .set(pct, animate?)
   * SVG with gradient stroke; the stroke-dashoffset transition is done in CSS.
   */
  function ring(o) {
    o = o || {};
    var id = 'ginnRing' + (++seq);
    var R = 50, C = 2 * Math.PI * R;
    var svg = '<svg class="ring-svg" viewBox="0 0 120 120" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>' +
      '<circle class="ring-ticks" cx="60" cy="60" r="58.5"/>' +
      '<circle class="ring-track" cx="60" cy="60" r="' + R + '"/>' +
      '<circle class="ring-bar" cx="60" cy="60" r="' + R + '" stroke="url(#' + id + ')" stroke-dasharray="' + C.toFixed(2) +
      '" stroke-dashoffset="' + C.toFixed(2) + '" transform="rotate(-90 60 60)"/>' +
      '</svg>';
    var num = h('span.ring-num', '0');
    var label = h('div.ring-label', o.label || '');
    var el = h('div', { class: ['ring', o.cls], role: 'img', 'aria-label': (o.label || '') + ' 0%' },
      h('div.ring-glow'), h('div', { html: svg, class: 'ring-art' }),
      h('div.ring-center', h('div.ring-val', num, h('span.ring-unit', '%')), label));
    if (o.size) el.style.setProperty('--ring', o.size + 'px');
    var barEl = el.querySelector('.ring-bar');
    var cur = 0, raf = 0;
    el.set = function (pct, animate) {
      var v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
      barEl.style.strokeDashoffset = (C * (1 - v / 100)).toFixed(2);
      barEl.style.opacity = v > 0 ? '1' : '0';
      el.setAttribute('aria-label', (o.label || '') + ' ' + v + '%');
      el.classList.toggle('is-full', v >= 100);
      if (raf) cancelAnimationFrame(raf);
      var from = cur;
      cur = v;
      if (animate === false || reducedMotion() || from === v) { num.textContent = String(v); return; }
      var t0 = 0, dur = 1100;
      function step(t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur);
        var e = 1 - Math.pow(1 - k, 3);
        num.textContent = String(Math.round(from + (v - from) * e));
        if (k < 1) raf = requestAnimationFrame(step); else raf = 0;
      }
      raf = requestAnimationFrame(step);
    };
    el.setLabel = function (t) { label.textContent = t; };
    return el;
  }

  /* ----------------------------------------------------------- sparkline */

  /**
   * sparkline({color, color2, min, max, points, height}) -> wrapper element with
   * .draw(values[])  (null values are skipped), .resize()
   * DPR-aware canvas, smooth curve, gradient fill, glowing head dot. Values are right-aligned.
   */
  function sparkline(o) {
    o = o || {};
    var points = o.points || 60;
    var canvas = h('canvas.spark-canvas', { 'aria-hidden': 'true' });
    var el = h('div.spark', canvas);
    var data = [];
    var w = 0, hgt = 0, dpr = 1;
    function measure() {
      var r = el.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      w = Math.max(10, Math.round(r.width));
      hgt = Math.max(10, Math.round(r.height || o.height || 64));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = hgt + 'px';
    }
    function paint() {
      if (!w) measure();
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hgt);
      // baseline grid
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      [0.33, 0.66].forEach(function (f) {
        var y = Math.round(hgt * f) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      });
      ctx.setLineDash([]);
      var vals = data.slice(-points);
      var pts = [];
      var lo = o.min, hi = o.max;
      var nums = vals.filter(function (v) { return typeof v === 'number' && isFinite(v); });
      if (!nums.length) return;
      if (lo == null || hi == null) {
        var mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums);
        var pad = Math.max((mx - mn) * 0.25, o.minSpan || 1);
        if (lo == null) lo = mn - pad;
        if (hi == null) hi = mx + pad;
      }
      if (hi - lo < 1e-6) hi = lo + 1;
      var step = w / (points - 1);
      var top = 6, bottom = hgt - 4;
      for (var i = 0; i < vals.length; i++) {
        var v = vals[i];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        var x = w - (vals.length - 1 - i) * step;
        var y = bottom - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (bottom - top);
        pts.push([x, y]);
      }
      if (!pts.length) return;
      var c1 = o.color || '#7C5CFF', c2 = o.color2 || c1;
      function path() {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (var j = 1; j < pts.length; j++) {
          var p0 = pts[j - 1], p1 = pts[j];
          var mx = (p0[0] + p1[0]) / 2;
          ctx.bezierCurveTo(mx, p0[1], mx, p1[1], p1[0], p1[1]);
        }
      }
      // fill
      path();
      ctx.lineTo(pts[pts.length - 1][0], hgt);
      ctx.lineTo(pts[0][0], hgt);
      ctx.closePath();
      var fg = ctx.createLinearGradient(0, top, 0, hgt);
      fg.addColorStop(0, hexA(c1, 0.32));
      fg.addColorStop(1, hexA(c1, 0));
      ctx.fillStyle = fg;
      ctx.fill();
      // line
      path();
      var lg = ctx.createLinearGradient(0, 0, w, 0);
      lg.addColorStop(0, hexA(c1, 0.55));
      lg.addColorStop(1, c2);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      // head
      var last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(last[0] - 3, last[1], 6, 0, Math.PI * 2);
      ctx.fillStyle = hexA(c2, 0.22);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(last[0] - 3, last[1], 3, 0, Math.PI * 2);
      ctx.fillStyle = c2;
      ctx.fill();
    }
    el.draw = function (vals) { if (vals) data = vals.slice(); paint(); };
    el.resize = function () { measure(); paint(); };
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(function () { el.resize(); });
      ro.observe(el);
      el.dispose = function () { ro.disconnect(); };
    } else {
      var onR = function () { el.resize(); };
      window.addEventListener('resize', onR);
      el.dispose = function () { window.removeEventListener('resize', onR); };
    }
    return el;
  }

  /* ------------------------------------------------------- layout bits */

  function card(cls) {
    var kids = Array.prototype.slice.call(arguments, 1);
    return h('div', { class: ['card'].concat(classList(cls)) }, kids);
  }

  /** pageHead({title, sub, actions:[nodes], back:{label, onClick}}) */
  function pageHead(o) {
    return h('header.page-head',
      o.back ? h('button', { type: 'button', class: 'back-link', onClick: o.back.onClick },
        icon('chevron-left', null, 18), h('span', o.back.label || 'Назад')) : null,
      h('div.page-head-row',
        h('div.page-head-text', h('h1.page-title', o.title), o.sub ? h('p.page-sub', o.sub) : null),
        o.actions && o.actions.length ? h('div.page-actions', o.actions) : null));
  }

  /** section(title, {extra, sub}) -> header node */
  function section(title, o) {
    o = o || {};
    return h('div.sec-head', h('div', h('h2.sec-title', title), o.sub ? h('p.sec-sub', o.sub) : null), o.extra || null);
  }

  /** skeleton(kind) kind: 'line' | 'block' | {h: px, w: '60%'} */
  function skeleton(o) {
    o = o || {};
    return h('div', { class: ['sk', o.cls], style: { height: (o.h || 14) + 'px', width: o.w || '100%' } });
  }

  function empty(o) {
    return h('div.empty',
      h('div.empty-ico', icon(o.icon || 'info', null, 26)),
      h('div.empty-title', o.title),
      o.text ? h('p.empty-text', o.text) : null,
      o.action || null);
  }

  /** errorState(err, retry) -> friendly error block */
  function errorState(err, retry, title) {
    var msg = (err && err.message) || 'Что-то пошло не так.';
    return h('div.empty.empty-error',
      h('div.empty-ico', icon('alert-circle', null, 26)),
      h('div.empty-title', title || 'Не удалось загрузить'),
      h('p.empty-text', msg),
      retry ? btn({ label: 'Повторить', icon: 'refresh', variant: 'ghost', size: 'sm', onClick: retry }) : null);
  }

  /** Game tile art: colored gradient square with emoji glyph or the host icon. */
  function gameArt(game, installed, size) {
    var color = (game && game.color) || '#7C5CFF';
    var glyph = (game && game.glyph) || '🎮';
    var art = h('div', {
      class: ['game-art', size ? 'game-art-' + size : null],
      style: {
        '--gc': color,
        background: 'radial-gradient(120% 120% at 20% 10%, ' + hexA(color, 1, 0.05) + ' 0%, ' + hexA(color, 1, 0.45) + ' 55%, ' + hexA(color, 1, 0.72) + ' 100%)',
        boxShadow: '0 10px 28px -12px ' + hexA(color, 0.75) + ', inset 0 1px 0 rgba(255,255,255,.22)'
      }
    });
    if (installed && installed.icon) {
      art.appendChild(h('img.game-icon', { src: installed.icon, alt: '', loading: 'lazy', draggable: 'false' }));
    } else {
      art.appendChild(h('span.game-glyph', { 'aria-hidden': 'true' }, glyph));
    }
    return art;
  }

  /* --------------------------------------------------------------- toast */

  var toastRoot = null;
  /**
   * toast(message, {tone:'info'|'good'|'warn'|'bad', action:{label, onClick}, duration}) -> {close()}
   * Bottom-centre on mobile, bottom-right on desktop.
   */
  function toast(msg, opts) {
    var o = typeof opts === 'string' ? { tone: opts } : (opts || {});
    var tone = o.tone || 'info';
    if (!toastRoot || !toastRoot.isConnected) {
      toastRoot = h('div.toasts', { 'aria-live': 'polite', 'aria-relevant': 'additions' });
      doc.body.appendChild(toastRoot);
    }
    var ICON = { info: 'info', good: 'check-circle', warn: 'alert', bad: 'alert-circle' };
    var timer = 0;
    var el = h('div', { class: ['toast', 'toast-' + tone], role: tone === 'bad' ? 'alert' : 'status' },
      h('span.toast-ico', { html: G.icon(ICON[tone] || 'info', { size: 20 }) }),
      h('div.toast-msg', msg),
      o.action ? h('button', {
        type: 'button', class: 'toast-act',
        onClick: function () { close(); try { o.action.onClick(); } catch (e) { console.error(e); } }
      }, o.action.label) : null,
      h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Закрыть', html: G.icon('x', { size: 16 }), onClick: function () { close(); } }));
    function close() {
      if (!el.parentNode || el.classList.contains('is-out')) return;
      clearTimeout(timer);
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, reducedMotion() ? 0 : 220);
    }
    toastRoot.appendChild(el);
    var all = toastRoot.querySelectorAll('.toast:not(.is-out)');
    if (all.length > 3) { var first = all[0]; first.classList.add('is-out'); setTimeout(function () { first.remove(); }, 200); }
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    var dur = o.duration || (o.action ? 7000 : 4200);
    timer = setTimeout(close, dur);
    el.addEventListener('mouseenter', function () { clearTimeout(timer); });
    el.addEventListener('mouseleave', function () { clearTimeout(timer); timer = setTimeout(close, 2000); });
    return { close: close, el: el };
  }

  /* --------------------------------------------------------------- modal */

  var stack = [];
  var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  /**
   * modal({title, body:Node|string, actions:[{label, variant, icon, onClick(api)->false keeps open|Promise}],
   *        dismissible:true, onClose(result), size:'wide', icon, tone})
   * -> api {el, body, close(result), setTitle, setBody, setActions, setDismissible, closed:Promise}
   * Bottom sheet below 900px, centred dialog on desktop. Esc / backdrop close when dismissible.
   */
  function modal(o) {
    o = o || {};
    var id = 'ginnDlg' + (++seq);
    var dismissible = o.dismissible !== false;
    var prevFocus = doc.activeElement;
    var resolveClosed;
    var closedP = new Promise(function (r) { resolveClosed = r; });

    var titleEl = h('h2.modal-title', { id: id }, o.title || '');
    var closeBtn = h('button', { type: 'button', class: 'modal-x', 'aria-label': 'Закрыть', html: G.icon('x', { size: 20 }), onClick: function () { if (dismissible) api.close(); } });
    var bodyEl = h('div.modal-body');
    var footEl = h('div.modal-foot');
    var head = h('div.modal-head',
      o.icon ? h('span', { class: ['modal-badge', 'tone-' + (o.tone || 'violet')], html: G.icon(o.icon, { size: 22 }) }) : null,
      titleEl, closeBtn);
    var panel = h('div', { class: ['modal', o.size ? 'modal-' + o.size : null], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabIndex: -1 },
      h('div.modal-grab', { 'aria-hidden': 'true' }), head, bodyEl, footEl);
    var backdrop = h('div.modal-backdrop', { onClick: function () { if (dismissible) api.close(); } });
    var root = h('div.modal-root', backdrop, panel);

    var api = {
      el: panel, body: bodyEl, closed: closedP, isOpen: true,
      close: function (result) {
        if (!api.isOpen) return;
        api.isOpen = false;
        var i = stack.indexOf(api);
        if (i >= 0) stack.splice(i, 1);
        root.classList.remove('is-open');
        root.classList.add('is-closing');
        setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, reducedMotion() ? 0 : 240);
        if (!stack.length) doc.body.classList.remove('has-modal');
        try { if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        if (o.onClose) { try { o.onClose(result); } catch (e) { console.error(e); } }
        resolveClosed(result);
      },
      setTitle: function (t) { titleEl.textContent = t; },
      setBody: function (b) { clear(bodyEl); addKids(bodyEl, [typeof b === 'string' ? h('p.modal-text', b) : b]); },
      setActions: function (list) {
        clear(footEl);
        footEl.style.display = list && list.length ? '' : 'none';
        (list || []).forEach(function (a) {
          var b = btn({
            label: a.label, icon: a.icon, variant: a.variant || 'ghost', cls: a.cls,
            onClick: function () {
              var r = a.onClick ? a.onClick(api) : undefined;
              if (r && typeof r.then === 'function') {
                return r.then(function (v) { if (v !== false && a.close !== false) api.close(a.value); });
              }
              if (r !== false && a.close !== false) api.close(a.value);
            }
          });
          if (a.autofocus) b.setAttribute('data-autofocus', '');
          footEl.appendChild(b);
        });
      },
      setDismissible: function (v) { dismissible = !!v; closeBtn.style.visibility = v ? '' : 'hidden'; }
    };
    api.setBody(o.body || '');
    api.setActions(o.actions || []);
    api.setDismissible(dismissible);

    doc.body.appendChild(root);
    doc.body.classList.add('has-modal');
    stack.push(api);
    requestAnimationFrame(function () {
      root.classList.add('is-open');
      var target = panel.querySelector('[data-autofocus]') || panel;
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    });
    return api;
  }

  doc.addEventListener('keydown', function (ev) {
    var top = stack[stack.length - 1];
    if (!top) return;
    if (ev.key === 'Escape') {
      var x = top.el.querySelector('.modal-x');
      if (x && x.style.visibility !== 'hidden') { ev.preventDefault(); top.close(); }
      return;
    }
    if (ev.key === 'Tab') {
      var f = Array.prototype.slice.call(top.el.querySelectorAll(FOCUSABLE)).filter(function (n) { return n.offsetParent !== null || n === doc.activeElement; });
      if (!f.length) { ev.preventDefault(); top.el.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (!top.el.contains(doc.activeElement)) { ev.preventDefault(); first.focus(); return; }
      if (ev.shiftKey && (doc.activeElement === first || doc.activeElement === top.el)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && doc.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });

  /** confirm({title, text, ok, cancel, danger, icon}) -> Promise<boolean> */
  function confirmDlg(o) {
    return new Promise(function (resolve) {
      var done = false;
      modal({
        title: o.title, icon: o.icon || (o.danger ? 'alert' : 'info'), tone: o.danger ? 'bad' : 'violet',
        body: h('p.modal-text', o.text || ''),
        actions: [
          { label: o.cancel || 'Отмена', variant: 'ghost', onClick: function () { done = true; resolve(false); } },
          { label: o.ok || 'Да', variant: o.danger ? 'danger' : 'primary', icon: o.okIcon, autofocus: true, onClick: function () { done = true; resolve(true); } }
        ],
        onClose: function () { if (!done) resolve(false); }
      });
    });
  }

  function closeTopModal() {
    var top = stack[stack.length - 1];
    if (!top) return false;
    var x = top.el.querySelector('.modal-x');
    if (x && x.style.visibility === 'hidden') return true; // busy, not dismissible: swallow back
    top.close();
    return true;
  }

  /* ------------------------------------------------------------ thermal */

  var THERMAL = {
    none: ['Норма', 'good'], light: ['Лёгкий нагрев', 'warn'], moderate: ['Заметный нагрев', 'warn'],
    severe: ['Сильный нагрев', 'bad'], critical: ['Перегрев', 'bad'], emergency: ['Перегрев!', 'bad'], shutdown: ['Отключение', 'bad']
  };
  /** thermal(stats) -> status badge or null (Stats.thermal is null on most PCs). */
  function thermal(s) {
    if (!s || !s.thermal || !THERMAL[s.thermal]) return null;
    var t = THERMAL[s.thermal];
    return badge(t[0], t[1], 'flame');
  }

  G.ui = {
    h: h, $: $, $$: $$, clear: clear, icon: icon, spinner: spinner, btn: btn, badge: badge, chip: chip, toggle: toggle,
    segmented: segmented, bar: bar, ring: ring, sparkline: sparkline, card: card, pageHead: pageHead, section: section,
    skeleton: skeleton, empty: empty, errorState: errorState, gameArt: gameArt, toast: toast, modal: modal,
    confirm: confirmDlg, closeTopModal: closeTopModal, hasModal: function () { return stack.length > 0; },
    thermal: thermal, THERMAL: THERMAL, hexA: hexA, reducedMotion: reducedMotion, isDesktop: isDesktop
  };
  G.h = h;
  G.$ = $;
  G.toast = toast;
  G.modal = modal;
})(window.GinN);
