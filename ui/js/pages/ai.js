/* GinN — GinN AI (#/ai). Two ways to get a plan from Claude:
 *   «Через приложение Claude» (default without a key): GinN.ai.handoff() -> copy the request + open claude.ai (the user's
 *     own free or Pro account; GinN never signs in) -> the user pastes Claude's answer -> GinN.ai.parseAnswer() -> plan.
 *   «Автоматически по API-ключу»: key onboarding, honest loading stages, plan, follow-up chat.
 * Plus «Базовый анализ без ИИ». Engine: GinN.ai (js/ai/advisor.js). Shared bits for Главная / Настройки: GinN.aiUi. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  G.pages = G.pages || {};

  /* Short names + one-line pitch per model (the engine's MODELS carry ids, prices and longer notes). */
  var MODEL_UI = {
    'claude-opus-5-5': { short: 'Opus 5.5', tag: 'Лучшее качество' },
    'claude-sonnet-5-5': { short: 'Sonnet 5.5', tag: 'Быстрее и дешевле' },
    'claude-haiku-5-5': { short: 'Haiku 5.5', tag: 'Самый дешёвый' }
  };
  var PRIORITY = { high: ['Важно', 'violet'], medium: ['Желательно', 'cyan'], low: ['Необязательно', 'muted'] };
  var ERR_TITLE = {
    AI_NO_KEY: 'Нужен ключ Claude', AI_BAD_KEY: 'Ключ не похож на настоящий', AI_AUTH: 'Ключ не подошёл',
    AI_BILLING: 'На счёте Anthropic нет денег', AI_RATE: 'Слишком много запросов', AI_BUSY: 'Claude сейчас перегружен',
    AI_NETWORK: 'Нет связи с Claude', AI_BAD_REQUEST: 'Запрос не принят', AI_REFUSAL: 'ИИ не стал отвечать',
    AI_TRUNCATED: 'Ответ оборвался', AI_BAD_OUTPUT: 'Ответ в непонятном виде', AI_FAILED: 'Не получилось'
  };
  var SUGGEST = ['Что даст больше всего FPS?', 'Почему именно эти шаги?', 'Это безопасно для устройства?'];

  var SS_KEY = 'ginn.ui.ai';
  function ssLoad() { try { return JSON.parse(window.sessionStorage.getItem(SS_KEY)) || null; } catch (e) { return null; } }
  function ssSave(v) { try { window.sessionStorage.setItem(SS_KEY, JSON.stringify(v)); } catch (e) { /* quota / blocked */ } }

  /* The request out to Claude also goes to localStorage: Android may kill GinN while the user is in Claude, and a new
   * WebView starts with an empty sessionStorage. Kept for 3 hours; the pasted answer is never stored there. */
  var PENDING_KEY = 'ai.pending';
  var PENDING_TTL = 3 * 3600 * 1000;
  function loadPending() {
    var p = G.store.get(PENDING_KEY, null);
    if (!p || typeof p !== 'object') return null;
    if (typeof p.prompt !== 'string' || !p.prompt || !(Date.now() - (Number(p.askedAt) || 0) < PENDING_TTL)) {
      G.store.remove(PENDING_KEY);
      return null;
    }
    return p;
  }

  /* ---------------------------------------------------------- session state (survives route changes) */

  var pending = loadPending();
  var pendingAt = pending ? pending.askedAt : null;
  var saved = ssLoad();
  if (!saved && pending) saved = { mode: 'app', note: pending.note, fps: pending.fps, app: Object.assign({}, pending, { stage: 'asked' }) };
  saved = saved || {};
  function appState(a) {
    a = a && typeof a === 'object' ? a : {};
    var asked = a.stage === 'asked' && typeof a.prompt === 'string' && !!a.prompt;
    return {
      stage: asked ? 'asked' : 'compose',     // 'asked' = the request went to Claude, waiting for the answer
      prompt: typeof a.prompt === 'string' ? a.prompt : '',
      url: typeof a.url === 'string' ? a.url : '',
      context: a.context && typeof a.context === 'object' ? a.context : null,
      goal: a.goal || null, gameId: a.gameId || null, fps: a.fps || null, note: typeof a.note === 'string' ? a.note : '',
      askedAt: a.askedAt || 0,
      answer: typeof a.answer === 'string' ? a.answer : ''
    };
  }
  var S = {
    status: null,
    goal: G.store.get('ai.goal', 'fps'),
    gameId: G.store.get('ai.game', null),
    fps: saved.fps || null,
    note: typeof saved.note === 'string' ? saved.note : '',
    mode: saved.mode === 'app' || saved.mode === 'api' ? saved.mode : null,   // null: app without a key, api with one
    app: appState(saved.app),
    appError: null,  // inline error of the last «Проверить план» {message}
    checking: false, // parseAnswer running
    clipOffer: null, // Claude's answer found on the clipboard after coming back (memory only, never stored)
    view: saved.result ? (saved.view || 'plan') : 'form',
    result: saved.result || null,
    include: saved.include || {},
    checks: saved.checks || {},
    chat: saved.chat || [],
    chatCost: saved.chatCost || 0,
    busy: null,    // running analysis {kind, stage, started, ctrl, cancelled}
    error: null,   // last analysis error (shown instead of the form)
    asking: null   // pending chat question
  };
  function persist() {
    ssSave({ view: S.view, result: S.result, include: S.include, checks: S.checks, chat: S.chat, chatCost: S.chatCost,
      mode: S.mode, note: S.note, fps: S.fps, app: S.app });
    syncPending();
  }
  /** Mirrors a request that is out to Claude into localStorage (written once per request), removes it otherwise. */
  function syncPending() {
    var a = S.app;
    if (a.stage === 'asked' && a.prompt) {
      if (pendingAt === a.askedAt) return;
      pendingAt = a.askedAt;
      G.store.set(PENDING_KEY, { prompt: a.prompt, url: a.url, context: a.context, goal: a.goal, gameId: a.gameId,
        fps: a.fps, note: a.note, askedAt: a.askedAt });
    } else if (pendingAt !== null) {
      pendingAt = null;
      G.store.remove(PENDING_KEY);
    }
  }
  /** A request is out to Claude and no plan is open: the app opens on GinN AI so the answer can be pasted. */
  function waitingForClaude() { return S.app.stage === 'asked' && !!S.app.prompt && S.view !== 'plan'; }
  /** 'app' (via the Claude app) or 'api' (own key). Without a working key it is always 'app'. */
  function currentMode() {
    var st = S.status;
    if (!st || st.available === false || !st.configured) return 'app';
    return S.mode === 'app' ? 'app' : 'api';
  }

  var mounted = null;   // {render} of the mounted page, null when the user is elsewhere
  function rerender() { if (mounted) mounted.render(); }

  /* ------------------------------------------------------------------ helpers */

  function ai() { return G.ai || null; }
  function modelName(id) {
    var m = ai() && ai().model(id);
    return m ? m.name : (id || 'Claude');
  }
  function modelShort(id) { return (MODEL_UI[id] && MODEL_UI[id].short) || modelName(id); }
  function grouped(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function usd(v) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return '$0';
    if (v < 0.001) return '< $0,001';
    var s = v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(1);
    return '$' + s.replace('.', ',');
  }
  function estimateText(model) {
    try { return ai().estimate(model).text; } catch (e) { return ''; }
  }
  function consoleUrl() { return (ai() && ai().CONSOLE_URL) || 'https://console.anthropic.com/'; }
  function claudeChatsUrl() { return (ai() && ai().CLAUDE_CHATS_URL) || 'https://claude.ai/recents'; }
  function hhmm(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function openConsole() {
    return G.host.openExternal({ url: consoleUrl() }).catch(function (e) { G.app.handleError(e); });
  }
  function errOf(e) {
    if (e && typeof e.code === 'string' && e.code.indexOf('AI_') === 0) return e;
    try { return ai().mapError(e); } catch (x) { var r = new Error((e && e.message) || 'Не получилось.'); r.code = 'AI_FAILED'; return r; }
  }
  function sourceBadge(src) {
    var ui = G.ui;
    if (src === 'demo') return ui.badge('Демо', 'warn', 'info');
    if (src === 'local') return ui.badge('Без ИИ', 'muted', 'list-checks');
    if (src === 'claude-app') return ui.badge('Claude · приложение', 'cyan', 'message');
    return ui.badge('ИИ · Claude', 'grad', 'sparkles');
  }
  function capReasons(limit) {
    var tierName = (G.devices && G.devices.tierNames && G.devices.tierNames[limit.tier]) || '';
    return (limit.reasons || []).map(function (r) {
      return {
        text: r.label === 'экран' ? 'экран ' + r.value + ' Гц' : r.label === 'мощность' ? 'мощность: ' + tierName : 'игра ' + (r.value >= 1000 ? 'без лимита' : r.value),
        limiting: !!r.limiting
      };
    });
  }
  function floorStep(limit, v) {
    var c = limit.steps.filter(function (s) { return s <= v; });
    return c.length ? c[c.length - 1] : limit.steps[0];
  }

  /* ---------------------------------------------------------------- key field + model picker */

  /** keyField({placeholder}) -> {el, input, value(), focus(), error(text|null)} — password-style with show/hide. */
  function keyField(o) {
    o = o || {};
    var ui = G.ui, h = ui.h;
    var input = h('input.ai-key-input', {
      type: 'password', placeholder: o.placeholder || 'sk-ant-…', autocomplete: 'off', autocapitalize: 'off',
      spellcheck: 'false', 'aria-label': 'API-ключ Claude', inputmode: 'text', maxlength: '300'
    });
    var eye = h('button', { type: 'button', class: 'ai-eye', 'aria-label': 'Показать ключ', 'aria-pressed': 'false', html: G.icon('eye', { size: 18 }) });
    var hint = h('div.ai-field-hint', 'Ключ начинается с «sk-ant-». Он хранится только на этом устройстве.');
    var wrap = h('label.ai-input', h('span.ai-input-ico', ui.icon('key', null, 18)), input, eye);
    var el = h('div.ai-field', h('div.ai-label', o.label || 'API-ключ Claude'), wrap, hint);
    var shown = false;
    eye.addEventListener('click', function (ev) {
      ev.preventDefault();
      shown = !shown;
      input.type = shown ? 'text' : 'password';
      eye.innerHTML = G.icon(shown ? 'eye-off' : 'eye', { size: 18 });
      eye.setAttribute('aria-pressed', shown ? 'true' : 'false');
      eye.setAttribute('aria-label', shown ? 'Скрыть ключ' : 'Показать ключ');
    });
    var errText = null;
    function paint() {
      var v = input.value.trim();
      ui.clear(hint);
      hint.className = 'ai-field-hint';
      wrap.classList.remove('is-bad', 'is-good');
      if (errText) {
        hint.classList.add('tone-bad'); wrap.classList.add('is-bad');
        hint.appendChild(ui.icon('alert-circle', null, 14)); hint.appendChild(h('span', errText));
      } else if (v && ai() && ai().looksLikeKey(v)) {
        hint.classList.add('tone-good'); wrap.classList.add('is-good');
        hint.appendChild(ui.icon('check-circle', null, 14)); hint.appendChild(h('span', 'Похоже на ключ Claude'));
      } else if (v && v.length > 6) {
        hint.appendChild(h('span', 'Ключ начинается с «sk-ant-» — скопируй его целиком.'));
      } else {
        hint.appendChild(h('span', 'Ключ начинается с «sk-ant-». Он хранится только на этом устройстве.'));
      }
    }
    input.addEventListener('input', function () { errText = null; paint(); });
    paint();
    return {
      el: el, input: input,
      value: function () { return input.value.trim(); },
      focus: function () { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } },
      error: function (t) { errText = t || null; paint(); }
    };
  }

  /** modelPicker(value, onChange) -> radio cards with price per plan. el.value() / el.setValue(v) */
  function modelPicker(value, onChange) {
    var ui = G.ui, h = ui.h;
    var models = (ai() && ai().MODELS) || [];
    var cur = value;
    var opts = [];
    var el = h('div.ai-models', { role: 'radiogroup', 'aria-label': 'Модель Claude' });
    models.forEach(function (m, i) {
      var meta = MODEL_UI[m.id] || { short: m.name, tag: m.note };
      var b = h('button', {
        type: 'button', role: 'radio', class: 'ai-model', 'aria-checked': m.id === cur ? 'true' : 'false', tabIndex: m.id === cur ? 0 : -1,
        dataset: { model: m.id },
        onClick: function () { pick(m.id, true); },
        onKeydown: function (ev) {
          var d = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          ev.preventDefault();
          var n = models[(i + d + models.length) % models.length];
          pick(n.id, true);
          opts[models.indexOf(n)].focus();
        }
      },
        h('span.ai-model-radio'),
        h('span.ai-model-text', h('span.ai-model-name', meta.short), h('span.ai-model-tag', meta.tag)),
        h('span.ai-model-price', h('b', estimateText(m.id)), h('span', 'за план')));
      opts.push(b);
      el.appendChild(b);
    });
    function pick(id, user) {
      cur = id;
      opts.forEach(function (b) {
        var on = b.dataset.model === id;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      if (user && onChange) onChange(id);
    }
    el.value = function () { return cur; };
    el.setValue = function (v) { pick(v, false); };
    return el;
  }

  /**
   * Saves a key (+ model), then checks it where that is free (page transport: GET /v1/models/{id}).
   * A key Claude rejects (AI_AUTH) is removed again. Resolves the new status or null (field shows the error).
   */
  function saveKey(field, model) {
    var A = ai(), ui = G.ui;
    var key = field.value();
    if (!key) { field.error('Вставь ключ Claude API.'); field.focus(); return Promise.resolve(null); }
    if (!A.looksLikeKey(key)) { field.error(A.ERRORS.AI_BAD_KEY); field.focus(); return Promise.resolve(null); }
    return A.configure({ key: key, model: model }).then(function (st) {
      S.status = st;
      S.mode = null;   // a fresh key: plans go through the API by default
      persist();
      return A.verify({ model: model }).then(function (v) {
        if (v && v.checked) ui.toast('Ключ работает — ИИ подключён', { tone: 'good' });
        else if (v && v.demo) ui.toast('Ключ сохранён (демо-режим: запросы к Claude не отправляются)', { tone: 'info' });
        else ui.toast('Ключ сохранён. Claude проверит его при первом запросе.', { tone: 'good' });
        return st;
      }, function (e) {
        e = errOf(e);
        if (e.code === 'AI_AUTH') {
          return A.clear().then(function (st2) { S.status = st2; }, function () { /* keep going */ }).then(function () {
            field.error(e.message);
            field.focus();
            return null;
          });
        }
        ui.toast('Ключ сохранён, но проверить его сейчас не вышло: ' + e.message, { tone: 'warn' });
        return st;
      });
    }, function (e) {
      e = errOf(e);
      field.error(e.message);
      return null;
    });
  }

  /** Bottom sheet / modal: change or remove the key, pick the model. Also used by Настройки. */
  function openKeyEditor(opts) {
    opts = opts || {};
    var ui = G.ui, h = ui.h, A = ai();
    if (!A) { ui.toast('Модуль ИИ не загрузился. Обнови GinN.', { tone: 'bad' }); return; }
    var st = S.status || { configured: false, model: A.DEFAULT_MODEL };
    var model = st.model || A.DEFAULT_MODEL;
    var field = keyField({ label: st.configured ? 'Новый ключ' : 'API-ключ Claude', placeholder: st.configured ? 'Вставь новый ключ, чтобы заменить' : 'sk-ant-…' });
    var picker = modelPicker(model, function (id) { model = id; });
    var statusRow = h('div.ai-keystate',
      h('div', { class: ['icon-tile', st.configured ? 'tone-good' : 'tone-muted'] }, ui.icon(st.configured ? 'check' : 'key', null, 20)),
      h('div.grow',
        h('div.ai-keystate-title', st.configured ? 'Ключ добавлен' : 'Ключ не добавлен'),
        h('div.ai-keystate-sub', st.transport === 'native' ? 'Хранится в зашифрованном виде на этом компьютере'
          : st.transport === 'mock' ? 'Демо-режим: ключ не нужен, Claude не вызывается' : 'Хранится только на этом устройстве')));
    var body = h('div.ai-keysheet', statusRow, field.el,
      h('div.ai-label', 'Модель'), picker,
      h('p.ai-fine', ui.icon('info', null, 14), h('span', 'Запросы оплачивает владелец ключа. Цена — примерная, для одного плана.')),
      h('button', { type: 'button', class: 'link-btn ai-console-link', onClick: openConsole }, 'Где взять ключ'));
    var actions = [];
    if (st.configured && st.transport !== 'mock') {
      actions.push({
        label: 'Удалить ключ', icon: 'trash', variant: 'danger', close: false,
        onClick: function (api) {
          return removeKey().then(function (ok) { if (ok) api.close(); });
        }
      });
    }
    actions.push({
      label: 'Сохранить', icon: 'check', variant: 'primary', close: false,
      onClick: function (api) {
        var p;
        if (field.value()) p = saveKey(field, model);
        else if (model !== st.model) {
          p = A.configure({ model: model }).then(function (s2) {
            S.status = s2;
            ui.toast('Модель: ' + modelName(model), { tone: 'good' });
            return s2;
          }, function (e) { field.error(errOf(e).message); return null; });
        } else if (!st.configured) { field.error('Вставь ключ Claude API.'); field.focus(); return false; }
        else { api.close(); return false; }
        return p.then(function (res) {
          if (!res) return;
          api.close();
          rerender();
          G.bus.emit('ui:ai', S.status);
        });
      }
    });
    ui.modal({ title: 'Ключ и модель', icon: 'key', body: body, actions: actions });
    if (opts.focusKey) setTimeout(function () { field.focus(); }, 280);
  }

  /** Confirm + GinN.ai.clear(). Resolves true when the key was removed. */
  function removeKey() {
    var ui = G.ui;
    return ui.confirm({
      title: 'Удалить ключ?', danger: true, ok: 'Удалить', okIcon: 'trash',
      text: 'GinN забудет ключ Claude на этом устройстве. Готовые планы останутся, а новый план можно будет получить через приложение Claude.'
    }).then(function (yes) {
      if (!yes) return false;
      return ai().clear().then(function (st) {
        S.status = st;
        S.mode = null;
        persist();
        ui.toast('Ключ удалён', { tone: 'good' });
        rerender();
        G.bus.emit('ui:ai', st);
        return true;
      }, function (e) { ui.toast(errOf(e).message, { tone: 'bad' }); return false; });
    });
  }

  /* ---------------------------------------------------------------- analysis (lives outside the page) */

  function abortError() { var e = new Error('Запрос отменён.'); e.code = 'AI_ABORTED'; return e; }

  /** kind: 'ai' (Claude) | 'local' (rules, «Базовый анализ без ИИ»). Stages are the real promise steps. */
  function runAnalysis(kind) {
    var A = ai();
    if (!A || S.busy) return;
    var app = G.app;
    var canAbort = kind === 'ai' && typeof AbortController === 'function' && !!S.status && S.status.transport !== 'native';
    var job = { kind: kind, stage: 0, started: Date.now(), ctrl: canAbort ? new AbortController() : null, cancelled: false };
    S.busy = job;
    S.error = null;
    rerender();
    var gameId = S.gameId || undefined;
    var fps = gameId ? S.fps || undefined : undefined;
    function stage(n) { if (job.cancelled) throw abortError(); job.stage = n; if (mounted && mounted.stage) mounted.stage(job); }

    A.collect({ gameId: gameId, fps: fps }).then(function (ctx) {
      stage(1);
      if (kind === 'local') return A.localPlan({ goal: S.goal, gameId: gameId, fps: fps, context: ctx });
      return A.plan({ goal: S.goal, gameId: gameId, fps: fps, note: S.note, context: ctx, signal: job.ctrl ? job.ctrl.signal : undefined });
    }).then(function (r) {
      stage(2);
      // «Готовлю план»: fresh tweak states so the plan shows what is already done.
      return Promise.all([app.tweaks(true).catch(function () { return null; }), G.sleep(kind === 'local' ? 350 : 450)]).then(function () { return r; });
    }).then(function (r) {
      if (job.cancelled || S.busy !== job) return;
      S.busy = null;
      r.goal = S.goal;
      S.result = r;
      S.include = {};
      S.checks = {};
      S.chat = [];
      S.chatCost = 0;
      S.view = 'plan';
      persist();
      if (mounted) { rerender(); mounted.scrollTop(); }
      else {
        G.ui.toast(kind === 'local' ? 'Базовый план готов' : 'План от ИИ готов', {
          tone: 'good', action: { label: 'Открыть', onClick: function () { app.go('ai'); } }
        });
      }
    }, function (e) {
      if (job.cancelled || S.busy !== job) return;   // cancelAnalysis() already reset the page
      S.busy = null;
      e = errOf(e);
      if (e.code === 'AI_ABORTED') {
        G.ui.toast('Запрос отменён', { tone: 'info' });
        rerender();
        return;
      }
      S.error = { code: e.code, message: e.message, requestId: e.requestId || null, kind: kind };
      if (mounted) rerender();
      else G.ui.toast(e.message, { tone: 'bad', action: { label: 'Открыть', onClick: function () { app.go('ai'); } } });
    });
  }

  function cancelAnalysis() {
    var job = S.busy;
    if (!job) return;
    job.cancelled = true;
    if (job.ctrl) { try { job.ctrl.abort(); } catch (e) { /* ignore */ } }
    S.busy = null;
    G.ui.toast('Запрос отменён', { tone: 'info' });
    rerender();
  }

  /* ===================================================================== page */

  G.pages.ai = {
    title: 'GinN AI',
    mount: function (root, ctx) {
      var ui = G.ui, h = ui.h, app = ctx.app, fmt = G.fmt, host = G.host;
      var A = ai();
      var alive = true;
      var offs = [];
      var timer = 0;
      var hw = null, games = null;
      var plat = app.platform;

      var sub = h('p.page-sub', 'Персональный план оптимизации от Claude');
      var actionsSlot = h('div.page-actions');
      root.appendChild(h('header.page-head', h('div.page-head-row',
        h('div.page-head-text', h('h1.page-title', h('span.ai-wordmark', 'GinN AI')), sub), actionsSlot)));
      var body = h('div.ai-body', h('div.card', ui.skeleton({ h: 22, w: '40%' }), ui.skeleton({ h: 14, w: '70%' }), ui.skeleton({ h: 120 })));
      root.appendChild(body);

      function viewEl() { return document.getElementById('view'); }
      var page = {
        render: render,
        chat: function () { paintChat(); scrollChat(); var m = root.querySelector('.ai-meta > span:last-child'); if (m && S.result) m.textContent = metaText(S.result); },
        stage: function (job) { if (stageRefs) paintStages(job); },
        scrollTop: function () { var v = viewEl(); if (v) v.scrollTop = 0; }
      };
      mounted = page;

      if (!A) {
        ui.clear(body);
        body.appendChild(h('div.card', ui.errorState({ message: 'Файл модуля ИИ не загрузился. Обнови GinN.' }, null, 'GinN AI недоступен')));
        return { unmount: function () { alive = false; if (mounted === page) mounted = null; } };
      }

      Promise.all([
        A.status(),
        app.hardware().catch(function () { return null; }),
        app.games().catch(function () { return []; })
      ]).then(function (r) {
        if (!alive) return;
        S.status = r[0];
        hw = r[1];
        games = r[2] || [];
        render();
        if (S.view !== 'plan' && !S.busy && currentMode() === 'app' && S.app.stage === 'asked') scrollToPaste();
        offerClipboard();
      });

      /* ------------------------------------------------------------ router of views */
      var stageRefs = null;
      function render() {
        if (!alive || !S.status) return;
        clearInterval(timer); timer = 0;
        stageRefs = null;
        ui.clear(body);
        ui.clear(actionsSlot);
        root.classList.remove('is-plan', 'is-busy');
        var st = S.status;
        var mode = currentMode();
        if (mode === 'app') {
          sub.textContent = st.configured ? 'Через приложение Claude · ключ не нужен' : 'План от Claude — ключ не нужен';
        } else {
          sub.textContent = st.transport === 'mock' ? 'Демо-режим · ' + modelName(st.model) + ' · запросы к Claude не отправляются'
            : modelName(st.model) + ' · ключ добавлен';
        }
        if (st.configured && st.available !== false) {
          actionsSlot.appendChild(ui.btn({ label: 'Ключ и модель', ariaLabel: 'Ключ и модель', title: 'Ключ и модель', icon: 'key', variant: 'ghost', size: 'sm', onClick: function () { openKeyEditor(); } }));
        }
        if (S.busy) { root.classList.add('is-busy'); body.appendChild(loadingView(S.busy)); return; }
        if (S.error) { body.appendChild(errorView(S.error)); return; }
        if (S.view === 'plan' && S.result) {
          root.classList.add('is-plan');
          actionsSlot.insertBefore(ui.btn({ label: 'Новый анализ', ariaLabel: 'Новый анализ', title: 'Новый анализ', icon: 'refresh', variant: 'ghost', size: 'sm', onClick: function () { toForm(); } }), actionsSlot.firstChild);
          body.appendChild(planView(S.result));
          return;
        }
        if (mode === 'app') { body.appendChild(appView({ noApi: st.available === false })); return; }
        body.appendChild(formView());
      }

      function toForm() {
        S.view = 'form';
        S.error = null;
        persist();
        render();
        page.scrollTop();
      }
      function setMode(m) {
        S.mode = m;
        S.view = 'form';
        S.error = null;
        persist();
        render();
        page.scrollTop();
      }

      /* ------------------------------------------------------------ side cards */
      function privacyCard() {
        return h('section.card.ai-privacy',
          h('div.ai-card-head', h('div.icon-tile.tone-cyan', ui.icon('shield', null, 20)),
            h('div', h('h3.ai-card-title', 'Что увидит Claude'), h('p.ai-card-sub', 'Только то, что нужно для плана'))),
          h('ul.ai-list',
            h('li.is-yes', ui.icon('check', null, 16), h('span', 'Характеристики: процессор, видеокарта, память, экран, батарея')),
            h('li.is-yes', ui.icon('check', null, 16), h('span', 'Состояние настроек GinN, загрузка и нагрев')),
            h('li.is-yes', ui.icon('check', null, 16), h('span', 'Игры из каталога GinN, которые у тебя есть')),
            h('li.is-no', ui.icon('x', null, 16), h('span', 'Не уходят: файлы, имя устройства, аккаунты и другие личные данные'))),
          h('p.ai-fine', ui.icon('info', null, 14), h('span', 'Через приложение весь запрос виден в чате Claude ещё до отправки. По API-ключу он уходит напрямую в Anthropic.')));
      }

      /** «Автоматически по API-ключу» without a key: the key form, secondary to the Claude app flow. */
      function keyCard() {
        var model = (S.status && S.status.model) || A.DEFAULT_MODEL;
        var field = keyField();
        var picker = modelPicker(model, function (id) { model = id; });
        var save = ui.btn({
          label: 'Сохранить ключ', icon: 'check', variant: 'primary', block: true, cls: 'ai-key-save', busyLabel: 'Проверяю ключ…',
          onClick: function () {
            return saveKey(field, model).then(function (st) { if (st && st.configured) { G.bus.emit('ui:ai', st); render(); page.scrollTop(); } });
          }
        });
        field.input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); save.click(); } });
        var steps = h('ol.ai-keysteps', (A.KEY_STEPS || []).map(function (t, i) { return h('li', h('span.ai-keystep-n', String(i + 1)), h('span', t)); }));
        var how = h('details.ai-how', h('summary', ui.icon('info', null, 16), h('span', 'Как получить ключ'), ui.icon('chevron-down', 'ai-how-chev', 16)), steps);
        return h('section.card.ai-keycard.is-secondary',
          h('div.ai-card-head', h('div.icon-tile.tone-violet', ui.icon('key', null, 20)),
            h('div', h('h3.ai-card-title', 'Автоматически по API-ключу'),
              h('p.ai-card-sub', 'План сразу в GinN, без копирования. Нужен платный ключ API — это не аккаунт Claude.'))),
          field.el,
          h('div.ai-label', 'Модель'), picker,
          save,
          h('div.ai-keylinks',
            h('button', { type: 'button', class: 'ai-linkbtn', onClick: openConsole }, ui.icon('external-link', null, 16), h('span', 'Где взять ключ'))),
          how);
      }

      /** With a key, while the Claude app mode is open: a way back to automatic plans. */
      function apiModeCard() {
        var st = S.status || {};
        return h('section.card.ai-apimode',
          h('div.ai-card-head', h('div.icon-tile.tone-good', ui.icon('key', null, 20)),
            h('div.grow', h('h3.ai-card-title', 'Автоматически по API-ключу'),
              h('p.ai-card-sub', st.transport === 'mock' ? 'Демо-режим · Claude не вызывается' : 'Ключ добавлен · ' + modelShort(st.model)))),
          h('p.ai-text', 'GinN сам спросит Claude и сразу покажет план — копировать ничего не нужно.'),
          ui.btn({ label: 'Анализировать по ключу', icon: 'sparkles', variant: 'soft', block: true, onClick: function () { setMode('api'); } }));
      }

      function lastPlanCard() {
        var r = S.result;
        return h('section.card.ai-last',
          h('div.ai-card-head', h('div.icon-tile.tone-violet', ui.icon('history', null, 20)),
            h('div.grow', h('h3.ai-card-title', 'Последний план'), h('p.ai-card-sub', fmt.count(r.plan.steps.length, 'шаг', 'шага', 'шагов') + (r.plan.game ? ' · ' + (G.games.get(r.plan.game.gameId) || {}).name : ''))),
            sourceBadge(r.source)),
          ui.btn({ label: 'Открыть план', icon: 'chevron-right', variant: 'soft', size: 'sm', block: true, onClick: function () { S.view = 'plan'; persist(); render(); page.scrollTop(); } }));
      }

      /* ------------------------------------------------------------ «Через приложение Claude» */
      var APP_STEPS = [
        ['Открой Claude', 'GinN соберёт запрос и откроет приложение или сайт'],
        ['Отправь запрос', 'GinN уже скопировал его — вставь в чат Claude'],
        ['Скопируй ответ и вернись', 'Вставь его ниже — GinN проверит план']
      ];
      var pasteRefs = null;

      function appView(opts) {
        opts = opts || {};
        var st = S.status || {};
        var asked = S.app.stage === 'asked' && !!S.app.prompt;
        var main = h('div.ai-app-main', flowCard(asked), pasteCard(asked));
        var side = h('div.ai-side');
        if (S.result) side.appendChild(lastPlanCard());
        if (!opts.noApi) side.appendChild(st.configured ? apiModeCard() : keyCard());
        side.appendChild(privacyCard());
        if (opts.noApi) {
          side.appendChild(h('section.card.ai-apimode', h('p.ai-fine', ui.icon('info', null, 14),
            h('span', 'Режим по API-ключу недоступен в этой версии приложения — обнови GinN. Через приложение Claude всё работает.'))));
        }
        return h('div.ai-form.ai-appview', main, side);
      }

      function flowCard(asked) {
        var steps = h('ol.ai-appsteps', APP_STEPS.map(function (x, i) {
          var state = asked ? (i < 2 ? 'done' : 'cur') : (i === 0 ? 'cur' : 'wait');
          return h('li', { class: ['ai-appstep', 'is-' + state] },
            h('span.ai-appstep-n', state === 'done' ? ui.icon('check', null, 14) : String(i + 1)),
            h('span.ai-appstep-text', h('b', x[0]), h('span', x[1])));
        }));
        var head = h('div.ai-app-head',
          h('span.ai-app-ico', ui.icon('message', null, 22)),
          h('div.grow',
            h('div.kicker', 'Через приложение Claude'),
            h('h2.ai-app-title', 'План от Claude — без ключа')));
        var card = h('section.card.ai-appflow',
          h('div.ai-hero-bg', { 'aria-hidden': 'true' }),
          head,
          h('p.ai-app-sub', 'GinN подготовит запрос с данными устройства, ты отправишь его в Claude и вставишь ответ сюда.'),
          steps,
          h('p.ai-fine.ai-app-note', ui.icon('shield', null, 14),
            h('span', 'Подойдёт бесплатный или Pro-аккаунт Claude. GinN не просит пароль и не входит в твой аккаунт.')));
        if (asked) card.appendChild(requestSummary());
        else {
          card.appendChild(h('div.ai-sec',
            h('div.ai-sec-head', h('span.ai-sec-n.is-ico', ui.icon('target', null, 14)), h('h2.ai-sec-title', 'Цель'), h('span.ai-sec-sub', 'Что важнее всего')),
            goalPicker()));
          card.appendChild(h('div.ai-sec',
            h('div.ai-sec-head', h('span.ai-sec-n.is-ico', ui.icon('gamepad', null, 14)), h('h2.ai-sec-title', 'Игра'), h('span.ai-sec-sub', 'необязательно')),
            gamePicker()));
          card.appendChild(h('div.ai-sec',
            h('div.ai-sec-head', h('span.ai-sec-n.is-ico', ui.icon('pencil', null, 14)), h('h2.ai-sec-title', 'Что ещё учесть?'), h('span.ai-sec-sub', 'необязательно')),
            noteField()));
          var cta = ui.btn({
            label: 'Спросить в Claude', icon: 'external-link', variant: 'primary', size: 'lg', cls: 'btn-glow ai-cta ai-app-cta', busyLabel: 'Готовлю запрос…',
            onClick: function () { return askClaude(); }
          });
          card.appendChild(h('div.ai-cta-row', cta,
            h('div.ai-cta-meta', h('span', 'Запрос скопируется, и откроется Claude'), h('span.ai-cta-who', 'бесплатно с твоим аккаунтом Claude'))));
          card.appendChild(h('div.ai-alt',
            h('button', { type: 'button', class: 'ai-linkbtn', onClick: function () { runAnalysis('local'); } }, ui.icon('list-checks', null, 16), h('span', 'Базовый анализ без ИИ')),
            h('span.ai-alt-note', 'по правилам GinN, без интернета')));
        }
        return card;
      }

      /** After «Спросить в Claude»: what was asked + resend / edit. */
      function requestSummary() {
        var a = S.app;
        var goal = A.goal(a.goal) || null;
        var game = a.gameId ? G.games.get(a.gameId) : null;
        var chips = h('div.ai-app-req-chips',
          goal ? ui.badge(goal.title, 'muted', G.icons.has(goal.icon) ? goal.icon : 'zap') : null,
          game ? ui.badge(game.name + (a.fps ? ' · ' + (a.fps >= 1000 ? 'без лимита' : a.fps + ' FPS') : ''), 'muted', 'gamepad') : null,
          a.note ? ui.badge('С заметкой', 'muted', 'pencil') : null);
        return h('div.ai-app-req',
          h('div.ai-app-req-head', h('span.ai-app-req-ico', ui.icon('check', null, 16)),
            h('div.grow', h('b', 'Запрос отправлен в Claude'), h('span', a.askedAt ? 'в ' + hhmm(a.askedAt) : ''))),
          chips,
          h('div.ai-app-req-acts',
            ui.btn({ label: 'Открыть Claude ещё раз', icon: 'external-link', variant: 'soft', size: 'sm', onClick: function () { return sendToClaude(); } }),
            ui.btn({ label: 'Скопировать запрос', icon: 'copy', variant: 'ghost', size: 'sm', onClick: function () { return copyPrompt(); } }),
            ui.btn({ label: 'Изменить', icon: 'pencil', variant: 'plain', size: 'sm', cls: 'ai-app-edit', onClick: function () { editRequest(); } })));
      }

      /** The paste step is where the user lands when coming back from Claude. */
      function scrollToPaste() {
        var el = root.querySelector('.ai-paste');
        if (!el) return;
        try { el.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (e) { /* ignore */ }
      }

      function editRequest() {
        S.app.stage = 'compose';
        S.clipOffer = null;
        persist();
        render();
        page.scrollTop();
      }

      function pasteCard(asked) {
        var ta = h('textarea.ai-paste-input', {
          rows: 7, placeholder: 'Вставь сюда ответ Claude', 'aria-label': 'Вставь сюда ответ Claude',
          spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off'
        });
        ta.value = S.app.answer || '';
        var saveT = 0;
        ta.addEventListener('input', function () {
          S.appError = null; paintPasteError();
          updCheck();
          clearTimeout(saveT);
          saveT = setTimeout(function () { S.app.answer = ta.value; persist(); }, 250);
        });
        var pasteBtn = ui.btn({ label: 'Вставить из буфера', icon: 'copy', variant: 'ghost', cls: 'ai-paste-btn', busyLabel: 'Читаю буфер…', onClick: function () { return pasteFromClipboard(); } });
        var checkBtn = ui.btn({ label: 'Проверить план', icon: 'check', variant: 'primary', cls: 'ai-check-btn', busyLabel: 'Проверяю…', onClick: function () { return checkAnswer(ta.value); } });
        function updCheck() { if (!checkBtn.isBusy()) checkBtn.disabled = !ta.value.trim(); }
        var chipSlot = h('div.ai-clip-slot');
        var err = h('div.ai-paste-err', { role: 'alert' });
        pasteRefs = { ta: ta, err: err, chipSlot: chipSlot, check: checkBtn, paste: pasteBtn, updCheck: updCheck };
        updCheck();
        paintPasteError();
        paintClipChip();
        return h('section', { class: ['card', 'ai-paste', asked ? 'is-active' : 'is-wait'] },
          h('div.ai-card-head',
            h('span.ai-paste-n', '3'),
            h('div.grow', h('h3.ai-card-title', asked ? 'Вставь ответ Claude' : 'Уже есть ответ Claude?'),
              h('p.ai-card-sub', asked ? 'В Claude нажми «Копировать» под ответом — скопируется всё, вместе с блоком кода'
                : 'Вставь его сюда — GinN проверит план'))),
          chipSlot,
          ta,
          err,
          h('div.ai-paste-acts', pasteBtn, checkBtn),
          h('p.ai-fine', ui.icon('shield', null, 14), h('span', 'GinN сверит каждый шаг со своим списком и ничего не включит без тебя.')));
      }

      function paintPasteError() {
        if (!pasteRefs) return;
        var e = pasteRefs.err;
        ui.clear(e);
        e.hidden = !S.appError;
        if (S.appError) { e.appendChild(ui.icon('alert-circle', null, 16)); e.appendChild(h('span', S.appError.message)); }
      }

      function paintClipChip() {
        if (!pasteRefs) return;
        var slot = pasteRefs.chipSlot;
        ui.clear(slot);
        slot.hidden = !S.clipOffer;
        if (!S.clipOffer) return;
        slot.appendChild(h('button', {
          type: 'button', class: 'ai-clip-chip',
          onClick: function () {
            var t = S.clipOffer;
            S.clipOffer = null;
            paintClipChip();
            fillAndCheck(t);
          }
        }, ui.icon('sparkles', null, 16), h('span', 'Вставить ответ Claude'), h('span.ai-clip-sub', 'из буфера')));
      }

      /** «Спросить в Claude»: build the request, copy it, open Claude. */
      function askClaude() {
        var gameId = S.gameId || null;
        var fps = gameId ? S.fps || null : null;
        return A.handoff({ goal: S.goal, gameId: gameId || undefined, fps: fps || undefined, note: S.note }).then(function (r) {
          if (!alive) return null;
          S.app = appState({
            stage: 'asked', prompt: r.prompt, url: r.url, context: r.context,
            goal: S.goal, gameId: gameId, fps: fps, note: S.note, askedAt: Date.now(), answer: S.app.answer
          });
          S.appError = null;
          S.clipOffer = null;
          persist();
          return sendToClaude().then(function () { if (alive && mounted === page) { render(); scrollToPaste(); } });
        }, function (e) { ui.toast(errOf(e).message, { tone: 'bad' }); });
      }

      /** Copies the request, then opens claude.ai/new (?q= carries it only when the URL stays short — not for Russian text). */
      function sendToClaude() {
        var a = S.app;
        if (!a.prompt) return Promise.resolve();
        var inUrl = a.url.indexOf('?q=') > 0;
        return host.copyText({ text: a.prompt }).then(function () { return true; }, function () { return false; }).then(function (copied) {
          if (!copied && !inUrl) { promptSheet(); return null; }   // nothing to paste from: show the text to copy by hand
          return host.openExternal({ url: a.url || (A.CLAUDE_NEW_URL || 'https://claude.ai/new') }).then(function () {
            ui.toast(!copied ? 'Запрос уже в поле ввода Claude — просто отправь его'
              : inUrl ? 'Запрос скопирован — если поле в Claude пустое, просто вставь'
                : 'Запрос скопирован — вставь его в чат Claude и отправь', { tone: 'good', duration: 6000 });
          }, function () {
            ui.toast('Не получилось открыть Claude. Открой приложение или сайт claude.ai сам и вставь запрос — он в буфере.', { tone: 'warn', duration: 7000 });
          });
        });
      }

      function copyPrompt() {
        if (!S.app.prompt) return null;
        return host.copyText({ text: S.app.prompt }).then(function () {
          ui.toast('Запрос скопирован', { tone: 'good' });
        }, function () { promptSheet(); });
      }

      /** Fallback when the clipboard is blocked: the request in a read-only field to copy by hand. */
      function promptSheet() {
        var ta = h('textarea.ai-paste-input.ai-prompt-view', { readOnly: true, rows: 10, 'aria-label': 'Запрос для Claude' });
        ta.value = S.app.prompt;
        ui.modal({
          title: 'Скопируй запрос', icon: 'copy',
          body: h('div.ai-keysheet', h('p.ai-text', 'Не получилось скопировать автоматически. Выдели текст, скопируй его и вставь в чат Claude.'), ta),
          actions: [
            { label: 'Открыть Claude', icon: 'external-link', variant: 'primary', onClick: function () {
              host.openExternal({ url: A.CLAUDE_NEW_URL || 'https://claude.ai/new' }).catch(function (e) { G.app.handleError(e); });
            } }
          ]
        });
        setTimeout(function () { try { ta.focus(); ta.select(); ta.scrollTop = 0; } catch (e) { /* ignore */ } }, 300);
      }

      function pasteFromClipboard() {
        if (typeof host.readText !== 'function') { ui.toast('Вставь ответ в поле вручную', { tone: 'info' }); return null; }
        return host.readText().then(function (r) {
          var t = (r && r.text) || '';
          if (!t.trim()) {
            ui.toast('В буфере пусто — скопируй ответ в Claude', { tone: 'info' });
            return null;
          }
          S.clipOffer = null;
          paintClipChip();
          fillAndCheck(t);
          return null;
        }, function () {
          ui.toast('Нет доступа к буферу. Вставь ответ в поле вручную: долгое нажатие → «Вставить».', { tone: 'info', duration: 6000 });
          if (pasteRefs) { try { pasteRefs.ta.focus(); } catch (e) { /* ignore */ } }
        });
      }

      /** Puts the text into the field and runs «Проверить план» through its button (busy state included). */
      function fillAndCheck(t) {
        if (!pasteRefs) { checkAnswer(t); return; }
        pasteRefs.ta.value = t;
        pasteRefs.updCheck();
        pasteRefs.check.click();
      }

      /** «Проверить план»: parseAnswer -> the regular plan view. Errors stay next to the text. */
      function checkAnswer(text) {
        if (S.checking) return null;
        text = String(text == null ? '' : text);
        S.app.answer = text;
        S.appError = null;
        S.checking = true;
        persist();
        paintPasteError();
        var ctxP = S.app.context ? Promise.resolve(S.app.context)
          : A.collect({ gameId: S.gameId || undefined, fps: S.gameId ? S.fps || undefined : undefined });
        return ctxP.then(function (c) { return A.parseAnswer(text, c); }).then(function (r) {
          // fresh tweak states, so the plan shows what is already done
          return app.tweaks(true).catch(function () { return null; }).then(function () { return r; });
        }).then(function (r) {
          S.checking = false;
          r.goal = S.app.goal || S.goal;
          S.result = r;
          S.include = {};
          S.checks = {};
          S.chat = [];
          S.chatCost = 0;
          S.view = 'plan';
          S.error = null;
          S.app.stage = 'compose';
          S.app.answer = '';
          S.clipOffer = null;
          persist();
          var unknown = (r.dropped || []).filter(function (d) { return d.why === 'unknown'; }).length;
          ui.toast(unknown ? 'План проверен. ' + fmt.count(unknown, 'шаг', 'шага', 'шагов') + ' не из списка GinN — пропущено.' : 'План проверен — можно применять',
            { tone: unknown ? 'info' : 'good' });
          if (mounted === page && alive) { render(); page.scrollTop(); }
        }, function (e) {
          S.checking = false;
          e = errOf(e);
          S.appError = { message: e.message };
          paintPasteError();
          if (pasteRefs) { try { pasteRefs.err.scrollIntoView({ block: 'nearest', behavior: ui.reducedMotion() ? 'auto' : 'smooth' }); } catch (x) { /* ignore */ } }
        });
      }

      /** Back from Claude (host:resume / focus) with a request out: offer the answer found on the clipboard. Never applies anything. */
      function offerClipboard() {
        if (!alive || S.busy || S.checking || S.view === 'plan' || S.error || currentMode() !== 'app' || S.app.stage !== 'asked') return;
        if (typeof host.readText !== 'function' || !A.looksLikeAnswer) return;
        host.readText().then(function (r) {
          var t = (r && r.text) || '';
          if (!alive || !A.looksLikeAnswer(t)) return;
          if (t.trim() === (pasteRefs ? pasteRefs.ta.value : S.app.answer || '').trim()) return;   // already in the field
          S.clipOffer = t;
          paintClipChip();
          if (pasteRefs) { try { pasteRefs.chipSlot.scrollIntoView({ block: 'nearest', behavior: ui.reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ } }
        }, function () { /* no clipboard access: the user pastes by hand */ });
      }

      /* ------------------------------------------------------------ form */
      function goalPicker() {
        var cards = [];
        var el = h('div.ai-goals', { role: 'radiogroup', 'aria-label': 'Цель' });
        A.GOALS.forEach(function (g, i) {
          var b = h('button', {
            type: 'button', role: 'radio', class: ['ai-goal', 'goal-' + g.id], 'aria-checked': g.id === S.goal ? 'true' : 'false', tabIndex: g.id === S.goal ? 0 : -1,
            onClick: function () { pick(g.id); },
            onKeydown: function (ev) {
              var d = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
              if (!d) return;
              ev.preventDefault();
              var n = (i + d + A.GOALS.length) % A.GOALS.length;
              pick(A.GOALS[n].id); cards[n].focus();
            }
          }, h('span.ai-goal-ico', ui.icon(G.icons.has(g.icon) ? g.icon : 'zap', null, 20)),
          h('span.ai-goal-text', h('span.ai-goal-title', g.title), h('span.ai-goal-desc', g.desc)),
          h('span.ai-goal-check', ui.icon('check', null, 14)));
          cards.push(b);
          el.appendChild(b);
        });
        function pick(id) {
          S.goal = id;
          G.store.set('ai.goal', id);
          cards.forEach(function (c, i) {
            var on = A.GOALS[i].id === id;
            c.setAttribute('aria-checked', on ? 'true' : 'false');
            c.tabIndex = on ? 0 : -1;
          });
        }
        return el;
      }

      function gameOptions() {
        var list = [];
        var seen = {};
        (games || []).forEach(function (x) {
          if (!x.game || seen[x.game.id]) return;
          if (!(plat === 'windows' ? x.game.pc : x.game.android)) return;
          seen[x.game.id] = true;
          list.push({ game: x.game, installed: x.installed });
        });
        var catalog = [];
        try { catalog = G.games.forPlatform(plat); } catch (e) { catalog = []; }
        catalog.forEach(function (g) { if (!seen[g.id]) { seen[g.id] = true; list.push({ game: g, installed: null }); } });
        return list;
      }

      function gamePicker() {
        var opts = gameOptions();
        if (S.gameId && !opts.some(function (o) { return o.game.id === S.gameId; })) S.gameId = null;
        var fpsWrap = h('div.ai-fps');
        var chips = [];
        var row = h('div.ai-gamechips', { role: 'radiogroup', 'aria-label': 'Игра' });
        function chipEl(o) {
          var id = o ? o.game.id : null;
          var on = (S.gameId || null) === id;
          var c = h('button', {
            type: 'button', role: 'radio', class: ['ai-gamechip', o && o.installed ? 'is-inst' : null], 'aria-checked': on ? 'true' : 'false',
            dataset: { game: id || '' }, onClick: function () { pick(id); }
          }, o ? ui.gameArt(o.game, o.installed, 'xs') : h('span.ai-nogame', ui.icon('x', null, 14)),
          h('span.ai-gamechip-name', o ? o.game.name : 'Без игры'),
          o && o.installed ? h('span.ai-inst-dot', { title: 'Установлена' }) : null);
          chips.push(c);
          return c;
        }
        row.appendChild(chipEl(null));
        var instCount = opts.filter(function (o) { return o.installed; }).length;
        // Installed games first; the rest of the catalog folds behind «Другие игры» (open if one of them is chosen).
        var rest = opts.filter(function (o) { return !o.installed; });
        var showAll = !instCount || rest.some(function (o) { return o.game.id === S.gameId; });
        opts.forEach(function (o) { if (o.installed) row.appendChild(chipEl(o)); });
        var restEls = [];
        if (rest.length) {
          if (instCount) restEls.push(row.appendChild(h('span.ai-chip-sep', { 'aria-hidden': 'true' })));
          rest.forEach(function (o) { restEls.push(row.appendChild(chipEl(o))); });
          if (instCount) {
            var more = h('button', { type: 'button', class: 'ai-gamechip ai-morechip', 'aria-expanded': 'false' },
              h('span', 'Другие игры · ' + rest.length), ui.icon('chevron-down', null, 16));
            more.addEventListener('click', function () { setRest(true); var first = restEls[1]; if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } });
            row.appendChild(more);
          }
        }
        function setRest(open) {
          restEls.forEach(function (n) { n.hidden = !open; });
          if (more) { more.hidden = open; more.setAttribute('aria-expanded', open ? 'true' : 'false'); }
        }
        setRest(showAll);
        function pick(id) {
          S.gameId = id;
          S.fps = null;
          G.store.set('ai.game', id);
          chips.forEach(function (c) { c.setAttribute('aria-checked', (c.dataset.game || null) === (id || null) || (c.dataset.game === '' && !id) ? 'true' : 'false'); });
          renderFps();
        }
        function renderFps() {
          ui.clear(fpsWrap);
          var g = S.gameId ? G.games.get(S.gameId) : null;
          fpsWrap.hidden = !g;
          if (!g) return;
          var limit = null;
          try { limit = G.games.fpsLimit(g, hw || {}, plat); } catch (e) { limit = null; }
          if (!limit || !limit.steps || !limit.steps.length) { fpsWrap.hidden = true; return; }
          var reco = floorStep(limit, limit.recommended);
          if (!S.fps || limit.steps.indexOf(S.fps) < 0) S.fps = reco;
          var seg = ui.segmented({
            pills: true, ariaLabel: 'Цель FPS', value: S.fps, cls: 'ai-fps-pills',
            options: limit.steps.map(function (s) { return { value: s, label: s >= 1000 ? '∞' : String(s), mark: s === reco, markTitle: 'Рекомендуем' }; }),
            onChange: function (v) { S.fps = v; }
          });
          var why = h('div.ai-cap-why');
          capReasons(limit).forEach(function (r, i) {
            if (i) why.appendChild(h('span.dot-sep', '·'));
            why.appendChild(h('span', { class: ['why', r.limiting ? 'is-limit' : null] }, r.text));
          });
          fpsWrap.appendChild(h('div.ai-fps-head', h('span.ai-label', 'Цель FPS'),
            h('span.ai-cap', 'Потолок ', h('b', limit.max >= 1000 ? 'без лимита' : limit.max + ' FPS'))));
          fpsWrap.appendChild(seg);
          fpsWrap.appendChild(why);
        }
        renderFps();
        return h('div.ai-gamepick', row, instCount ? null : h('p.ai-hint', 'Установленных игр не нашлось — выбери из каталога или оставь «Без игры».'), fpsWrap);
      }

      function noteField() {
        var note = h('textarea.ai-note', {
          rows: 3, maxlength: '500', placeholder: 'Например: играю на зарядке, телефон сильно греется, важен пинг',
          'aria-label': 'Что ещё учесть?'
        });
        note.value = S.note || '';
        var counter = h('span.ai-note-count', (note.value.length) + ' / 500');
        var saveT = 0;
        note.addEventListener('input', function () {
          S.note = note.value;
          counter.textContent = note.value.length + ' / 500';
          clearTimeout(saveT);
          saveT = setTimeout(persist, 300);
        });
        return h('div.ai-note-wrap', note, counter);
      }

      function formView() {
        var st = S.status;
        var cta = ui.btn({
          label: 'Анализировать с ИИ', icon: 'sparkles', variant: 'primary', size: 'lg', cls: 'btn-glow ai-cta',
          onClick: function () { runAnalysis('ai'); }
        });
        var costLine = h('div.ai-cta-meta',
          h('span', st.transport === 'mock' ? 'Демо: Claude не вызывается, ответ собран по правилам' : modelName(st.model) + ' · ' + estimateText(st.model) + ' за план'),
          st.transport === 'mock' ? null : h('span.ai-cta-who', 'оплачивает владелец ключа'));
        var compose = h('section.card.ai-compose',
          h('div.ai-sec',
            h('div.ai-sec-head', h('span.ai-sec-n', '1'), h('h2.ai-sec-title', 'Цель'), h('span.ai-sec-sub', 'Что важнее всего')),
            goalPicker()),
          h('div.ai-sec',
            h('div.ai-sec-head', h('span.ai-sec-n', '2'), h('h2.ai-sec-title', 'Игра'), h('span.ai-sec-sub', 'необязательно')),
            gamePicker()),
          h('div.ai-sec',
            h('div.ai-sec-head', h('span.ai-sec-n', '3'), h('h2.ai-sec-title', 'Что ещё учесть?'), h('span.ai-sec-sub', 'необязательно')),
            noteField()),
          h('div.ai-cta-row', cta, costLine),
          h('div.ai-alt',
            h('button', { type: 'button', class: 'ai-linkbtn', onClick: function () { runAnalysis('local'); } }, ui.icon('list-checks', null, 16), h('span', 'Базовый анализ без ИИ')),
            h('span.ai-alt-note', 'по правилам GinN, бесплатно')),
          h('div.ai-alt.ai-alt-app',
            h('button', { type: 'button', class: 'ai-linkbtn ai-to-app', onClick: function () { setMode('app'); } }, ui.icon('message', null, 16), h('span', 'Через приложение Claude')),
            h('span.ai-alt-note', 'без ключа — с твоим аккаунтом Claude')));

        var side = h('div.ai-side');
        if (S.result) side.appendChild(lastPlanCard());
        side.appendChild(h('section.card.ai-how-card',
          h('h3.ai-card-title', 'Как это работает'),
          h('ol.ai-flow',
            h('li', h('span.ai-flow-ico', ui.icon('cpu', null, 16)), h('span', h('b', 'GinN собирает данные'), h('span', 'железо, нагрев, состояние настроек и игры'))),
            h('li', h('span.ai-flow-ico', ui.icon('sparkles', null, 16)), h('span', h('b', 'Claude анализирует'), h('span', 'и предлагает шаги с объяснением'))),
            h('li', h('span.ai-flow-ico', ui.icon('check', null, 16)), h('span', h('b', 'Ты решаешь'), h('span', 'отмечаешь шаги и применяешь — всё можно откатить')))),
          h('p.ai-fine', ui.icon('shield', null, 14), h('span', 'ИИ видит характеристики устройства и список оптимизаций, но не твои файлы и не имя устройства.'))));
        return h('div.ai-form', compose, side);
      }

      /* ------------------------------------------------------------ loading */
      function loadingView(job) {
        var st = S.status || {};
        var local = job.kind === 'local';
        var names = local
          ? [['Собираю данные', 'Железо, нагрев, настройки и игры'], ['Подбираю шаги', 'По правилам GinN, без ИИ'], ['Готовлю план', 'Сверяю шаги с текущими настройками']]
          : [['Собираю данные', 'Железо, нагрев, настройки и игры'], ['ИИ анализирует', modelName(st.model) + ' думает над планом'], ['Готовлю план', 'Проверяю шаги по списку оптимизаций']];
        stageRefs = names.map(function (n) {
          var ico = h('span.ai-stage-ico');
          var row = h('li.ai-stage', ico, h('span.ai-stage-text', h('b', n[0]), h('span', n[1])));
          return { row: row, ico: ico };
        });
        var elapsed = h('span.ai-elapsed', '0:00');
        var cancel = job.ctrl ? ui.btn({ label: 'Отменить', icon: 'x', variant: 'ghost', size: 'sm', onClick: function () { cancelAnalysis(); } }) : null;
        var hint = local ? 'Это быстро — несколько секунд.'
          : st.transport === 'mock' ? 'Демо-режим: ответ придёт через пару секунд.'
            : 'Обычно 20–60 секунд, иногда до двух минут. Можно уйти на другой экран — план придёт сюда.';
        var card = h('section.card.ai-loading',
          h('div.ai-hero-bg', { 'aria-hidden': 'true' }),
          h('div.ai-orb.is-busy', { 'aria-hidden': 'true' }, h('span.ai-orb-ring'), h('span.ai-orb-core', ui.icon(local ? 'list-checks' : 'sparkles', null, 30))),
          h('h2.ai-loading-title', { 'aria-live': 'polite' }, local ? 'Собираю базовый план' : 'ИИ готовит план'),
          h('p.ai-loading-sub', hint),
          h('ol.ai-stages', stageRefs.map(function (s) { return s.row; })),
          h('div.ai-loading-foot', h('span.ai-elapsed-wrap', ui.icon('clock', null, 14), elapsed),
            cancel || (local ? null : h('span.ai-fine-inline', 'Запрос нельзя прервать — дождись ответа'))));
        paintStages(job);
        function tick() {
          var s = Math.max(0, Math.floor((Date.now() - job.started) / 1000));
          elapsed.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
        }
        tick();
        timer = setInterval(function () { if (!alive || S.busy !== job) { clearInterval(timer); timer = 0; return; } tick(); }, 1000);
        return card;
      }

      function paintStages(job) {
        if (!stageRefs) return;
        stageRefs.forEach(function (s, i) {
          var state = i < job.stage ? 'done' : i === job.stage ? 'run' : 'wait';
          s.row.className = 'ai-stage is-' + state;
          ui.clear(s.ico);
          if (state === 'run') s.ico.appendChild(ui.spinner());
          else s.ico.innerHTML = G.icon(state === 'done' ? 'check' : 'clock', { size: 15, stroke: state === 'done' ? 2.8 : 2 });
        });
      }

      /* ------------------------------------------------------------ errors */
      function errorView(err) {
        var code = err.code || 'AI_FAILED';
        var acts = [];
        var retry = ui.btn({ label: 'Повторить', icon: 'refresh', variant: 'primary', onClick: function () { S.error = null; runAnalysis(err.kind || 'ai'); } });
        var local = ui.btn({ label: 'Базовый анализ без ИИ', icon: 'list-checks', variant: 'ghost', onClick: function () { S.error = null; runAnalysis('local'); } });
        if (code === 'AI_NO_KEY' || code === 'AI_AUTH') acts.push(ui.btn({ label: code === 'AI_AUTH' ? 'Проверь ключ' : 'Добавить ключ', icon: 'key', variant: 'primary', onClick: function () { openKeyEditor({ focusKey: true }); } }));
        else if (code === 'AI_BILLING') acts.push(ui.btn({ label: 'Пополнить баланс', icon: 'external-link', variant: 'primary', onClick: openConsole }), retry);
        else if (code === 'AI_BAD_REQUEST') acts.push(ui.btn({ label: 'Сменить модель', icon: 'sliders', variant: 'primary', onClick: function () { openKeyEditor(); } }), ui.btn({ label: 'Повторить', icon: 'refresh', variant: 'ghost', onClick: function () { S.error = null; runAnalysis('ai'); } }));
        else if (code === 'AI_REFUSAL') acts.push(local, ui.btn({ label: 'Изменить запрос', icon: 'pencil', variant: 'ghost', onClick: toForm }));
        else if (code === 'AI_BUSY' || code === 'AI_RATE' || code === 'AI_NETWORK') acts.push(retry, local);
        else acts.push(retry);
        var tone = code === 'AI_NETWORK' || code === 'AI_RATE' || code === 'AI_BUSY' ? 'warn' : 'bad';
        return h('section', { class: ['card', 'ai-error', 'tone-' + tone] },
          h('div.ai-error-ico', ui.icon(code === 'AI_NETWORK' ? 'wifi' : code === 'AI_AUTH' || code === 'AI_NO_KEY' ? 'key' : code === 'AI_BILLING' ? 'alert' : 'alert-circle', null, 26)),
          h('h2.ai-error-title', ERR_TITLE[code] || ERR_TITLE.AI_FAILED),
          h('p.ai-error-text', err.message),
          code === 'AI_RATE' ? h('p.ai-hint', 'Подожди минуту и попробуй снова.') : null,
          h('div.ai-error-acts', acts),
          h('button', { type: 'button', class: 'back-link ai-error-back', onClick: toForm }, ui.icon('chevron-left', null, 18), h('span', 'К настройкам анализа')),
          err.requestId ? h('p.ai-reqid', 'ID запроса: ' + err.requestId) : null);
      }

      /* ------------------------------------------------------------ plan */
      function liveTweaks() {
        var map = {};
        ((S.result && S.result.context && S.result.context.tweaks) || []).forEach(function (t) { map[t.id] = t; });
        (app.lastTweaks || []).forEach(function (t) { map[t.id] = Object.assign({}, map[t.id] || {}, t); });
        return map;
      }
      function stepDone(step, t) {
        if (!t) return false;
        if (t.kind === 'action') return !!app.ranActions[t.id] || t.state === 'on';
        if (t.kind === 'link') return t.state === 'on';
        return t.state === (step.enable === false ? 'off' : 'on');
      }
      function included(step, t) {
        if (Object.prototype.hasOwnProperty.call(S.include, step.tweakId)) return !!S.include[step.tweakId];
        return !stepDone(step, t);
      }

      function planView(r) {
        var p = r.plan;
        var goal = A.goal(r.goal) || null;
        var tw = liveTweaks();
        var gameEntry = p.game ? G.games.get(p.game.gameId) : null;

        /* hero */
        var chipsRow = h('div.ai-plan-chips', sourceBadge(r.source),
          goal ? ui.badge(goal.title, 'muted', G.icons.has(goal.icon) ? goal.icon : 'zap') : null,
          gameEntry ? ui.badge(gameEntry.name, 'muted', 'gamepad') : null);
        var hero = h('section.card.ai-plan-hero',
          h('div.ai-hero-bg', { 'aria-hidden': 'true' }),
          chipsRow,
          h('h2.ai-plan-summary', p.summary || 'План готов'),
          p.expectedGain ? h('div.ai-gain', h('span.ai-gain-ico', ui.icon('trending-up', null, 18)), h('div', h('div.ai-gain-label', 'Ожидаемый эффект'), h('div.ai-gain-text', p.expectedGain))) : null);

        var warns = p.warnings && p.warnings.length ? h('div.banner.banner-warn.ai-warns', { role: 'note' },
          h('div.banner-ico', ui.icon('alert', null, 20)),
          h('div.banner-text', h('div.banner-title', 'Обрати внимание'),
            h('ul.ai-warn-list', p.warnings.map(function (w) { return h('li', w); })))) : null;

        /* steps */
        var countEl = h('span.ai-steps-count');
        var applyBtn = ui.btn({ label: 'Применить план', icon: 'zap', variant: 'primary', size: 'lg', cls: 'btn-glow', busyLabel: 'Применяю…', onClick: function () { return applyPlan(); } });
        var rows = p.steps.map(function (s) { return stepRow(s, tw[s.tweakId]); });
        function updCount() {
          var n = p.steps.filter(function (s) { return included(s, tw[s.tweakId]); }).length;
          countEl.textContent = p.steps.length ? 'Выбрано ' + n + ' из ' + p.steps.length : offList ? 'Нет шагов из списка GinN' : 'Менять нечего';
          applyBtn.disabled = n === 0;
          applyBtn.setLabel(n ? 'Применить план' : 'Отметь шаги');
        }
        // no steps because Claude named ones GinN does not have — not because everything is already done
        var offList = (r.dropped || []).some(function (d) { return d.why === 'unknown'; });
        var stepsCard = h('section.card.ai-steps',
          h('div.ai-card-head', h('div.icon-tile.tone-violet', ui.icon('list-checks', null, 20)),
            h('div.grow', h('h3.ai-card-title', 'Шаги плана'), h('p.ai-card-sub', countEl))),
          p.steps.length ? h('ol.ai-step-list', rows) : h('div', { class: ['ai-steps-empty', offList ? 'is-off-list' : null] },
            ui.icon(offList ? 'alert-circle' : 'check-circle', null, 18),
            h('span', offList ? 'Шаги Claude не совпали со списком GinN, поэтому применять нечего. Попроси Claude взять id оптимизаций из запроса.'
              : r.source === 'local' ? 'Всё рекомендованное для этой цели уже включено.'
                : r.source === 'claude-app' ? 'Claude не нашёл, что ещё поменять, — система уже настроена.' : 'ИИ не нашёл, что ещё поменять, — система уже настроена.')),
          p.steps.length ? h('div.ai-steps-foot', applyBtn, h('span.ai-fine-inline', ui.icon('rotate-ccw', null, 14), 'Всё можно откатить в «Настройках»')) : null);
        updCount();

        function stepRow(s, t) {
          var title = (t && t.title) || s.tweakId;
          var done = stepDone(s, t);
          var on = included(s, t);
          var cb = h('input.ck-input', { type: 'checkbox', checked: on, 'aria-label': title });
          var badges = [];
          var pr = PRIORITY[s.priority] || PRIORITY.medium;
          badges.push(ui.badge(pr[0], pr[1]));
          if (t && t.kind === 'link') badges.push(ui.badge('Вручную', 'cyan', 'external-link'));
          if (s.enable === false) badges.push(ui.badge('Выключить', 'warn', 'power'));
          if (t && t.requiresAdmin) badges.push(ui.badge('Админ', app.notAdmin() ? 'warn' : 'violet', 'shield'));
          if (t && t.requiresReboot) badges.push(ui.badge('Перезагрузка', 'cyan', 'rotate-ccw'));
          if (t && t.risk === 'moderate') badges.push(ui.badge('Осторожно', 'warn', 'alert'));
          if (done) badges.push(ui.badge('Сделано', 'good', 'check'));
          var openBtn = t && t.kind === 'link' ? ui.btn({
            label: 'Открыть', icon: 'external-link', variant: 'ghost', size: 'sm',
            onClick: function () { return app.applyTweak(t, true).then(function (res) { if (res && res.message) ui.toast(res.message, { tone: 'info' }); }); }
          }) : null;
          var row = h('li', { class: ['ai-step', on ? 'is-on' : null, done ? 'is-done' : null] },
            h('label.ai-step-check', cb, h('span.ck-box', { html: G.icon('check', { size: 14, stroke: 3 }) })),
            h('div.ai-step-main',
              h('div.ai-step-title', title),
              h('p.ai-step-reason', s.reason),
              h('div.ai-step-badges', badges)),
            openBtn ? h('div.ai-step-act', openBtn) : null);
          cb.addEventListener('change', function () {
            S.include[s.tweakId] = cb.checked;
            row.classList.toggle('is-on', cb.checked);
            persist();
            updCount();
          });
          return row;
        }

        /* game */
        var side = h('div.ai-plan-side');
        if (p.game && gameEntry) side.appendChild(gameCard(p.game, gameEntry));
        if (p.tips && p.tips.length) {
          side.appendChild(h('section.card.ai-tips',
            h('div.ai-card-head', h('div.icon-tile.tone-warn', ui.icon('lightbulb', null, 20)), h('div', h('h3.ai-card-title', 'Советы'))),
            h('ul.ai-tip-list', p.tips.map(function (t) { return h('li', ui.icon('sparkles', null, 14), h('span', t)); }))));
        }

        /* meta */
        var meta = h('footer.ai-meta', sourceBadge(r.source), h('span', metaText(r)));

        var grid = h('div', { class: ['ai-plan-grid', side.childNodes.length ? null : 'is-single'] }, stepsCard, side.childNodes.length ? side : null);
        return h('div.ai-plan', hero, warns, grid, r.source === 'claude-app' ? appChatCard() : chatCard(r), meta);
      }

      function metaText(r) {
        if (r.source === 'local') return 'Базовый анализ без ИИ · по правилам GinN · бесплатно';
        if (r.source === 'claude-app') {
          var unknown = (r.dropped || []).filter(function (d) { return d.why === 'unknown'; }).length;
          return ['План из приложения Claude', 'шаги сверены со списком GinN'].concat(unknown
            ? ['пропущено ' + fmt.count(unknown, 'предложение', 'предложения', 'предложений') + ' не из списка'] : []).join(' · ');
        }
        var u = r.usage || {};
        var tokens = (u.input_tokens || 0) + (u.output_tokens || 0);
        var parts = ['Модель: ' + modelName(r.model)];
        if (r.requestedModel && r.model && r.requestedModel !== r.model) parts.push('ответила резервная модель вместо ' + modelShort(r.requestedModel));
        parts.push('≈ ' + usd(r.costUsd));
        parts.push(grouped(tokens) + ' ' + fmt.plural(tokens, 'токен', 'токена', 'токенов'));
        if (S.chatCost > 0) parts.push('чат ≈ ' + usd(S.chatCost));
        if (r.source === 'demo') parts.push('запрос к Claude не отправлялся');
        return parts.join(' · ');
      }

      function gameCard(g, entry) {
        var key = entry.id + '.' + g.preset + '.' + g.fps;
        var checks = S.checks[key] || {};
        var total = g.settings.length, done = 0;
        var prog = ui.bar(0, 'grad');
        var cnt = h('span.ck-count');
        function upd() { cnt.textContent = done + ' из ' + total; prog.set(total ? done / total * 100 : 0, done === total && total ? 'good' : 'grad'); }
        var items = g.settings.map(function (txt, i) {
          var k = i + ':' + txt;
          var on = !!checks[k];
          if (on) done++;
          var cb = h('input.ck-input', { type: 'checkbox', checked: on });
          var row = h('label', { class: ['ck-item', on ? 'is-done' : null] }, cb, h('span.ck-box', { html: G.icon('check', { size: 14, stroke: 3 }) }), h('span.ck-text', txt));
          cb.addEventListener('change', function () {
            var c = S.checks[key] || (S.checks[key] = {});
            if (cb.checked) { c[k] = 1; done++; } else { delete c[k]; done--; }
            row.classList.toggle('is-done', cb.checked);
            persist();
            upd();
          });
          return row;
        });
        upd();
        var installed = (games || []).some(function (x) { return x.game && x.game.id === entry.id; });
        var canWrite = plat === 'windows' && host.has('games.profile') && entry.pc && entry.pc.profile && installed;
        var acts = h('div.ai-game-acts',
          ui.btn({
            label: 'Открыть в Играх', icon: 'gamepad', variant: 'ghost', size: 'sm',
            onClick: function () {
              var pk = 'game.' + plat + '.' + entry.id;
              var prev = G.store.get(pk, {}) || {};
              G.store.set(pk, { fps: g.fps, preset: g.preset, gray: prev.gray !== false });
              app.go('games/' + encodeURIComponent(entry.id));
            }
          }),
          canWrite ? ui.btn({
            label: 'Применить в игре', icon: 'wrench', variant: 'soft', size: 'sm', busyLabel: 'Применяю…',
            onClick: function () {
              return A.applyGame(g).then(function (res) {
                if (res.status === 'done') ui.toast(res.message || 'Профиль игры применён', { tone: 'good' });
                else if (res.status === 'needs-permission') app.handleError({ code: 'NEEDS_PERMISSION', message: res.message });
                else ui.toast(res.message, { tone: res.status === 'manual' ? 'info' : 'bad' });
              });
            }
          }) : null);
        return h('section.card.ai-game',
          h('div.ai-game-head', ui.gameArt(entry, null, 'sm'),
            h('div.grow', h('h3.ai-card-title', entry.name),
              h('div.ai-game-badges', ui.badge(g.fps >= 1000 ? 'Без лимита FPS' : g.fps + ' FPS', 'violet', 'target'),
                ui.badge((G.games.presets[g.preset] || {}).title || g.preset, 'cyan', 'layers')))),
          g.reason ? h('p.ai-text', g.reason) : null,
          total ? h('div.ck-progress', prog, cnt) : null,
          total ? h('div.ai-game-settings', items) : null,
          acts);
      }

      /* ------------------------------------------------------------ chat */
      var chatRefs = null;

      /** Plans from the Claude app: questions go to the same Claude chat (the API chat needs a key). */
      function appChatCard() {
        chatRefs = null;
        return h('section.card.ai-chat.ai-chat-app',
          h('div.ai-card-head', h('div.icon-tile.tone-cyan', ui.icon('message', null, 20)),
            h('div.grow', h('h3.ai-card-title', 'Есть вопросы по плану?'),
              h('p.ai-card-sub', 'Продолжай разговор в Claude — там уже есть данные твоего устройства'))),
          h('p.ai-text', 'Если Claude поменяет план, скопируй его новый ответ и вставь в GinN — шаги снова проверятся.'),
          h('div.ai-chat-app-acts',
            ui.btn({ label: 'Открыть Claude', icon: 'external-link', variant: 'soft', size: 'sm',
              onClick: function () { return host.openExternal({ url: claudeChatsUrl() }).catch(function (e) { app.handleError(e); }); } }),
            ui.btn({ label: 'Вставить новый ответ', icon: 'copy', variant: 'ghost', size: 'sm',
              onClick: function () {
                S.mode = currentMode() === 'api' ? 'app' : S.mode;
                if (S.app.prompt) S.app.stage = 'asked';
                S.view = 'form';
                persist();
                render();
                page.scrollTop();
                setTimeout(function () { if (pasteRefs) { try { pasteRefs.ta.focus({ preventScroll: false }); } catch (e) { /* ignore */ } } }, 60);
              } })));
      }
      function chatCard(r) {
        var local = r.source === 'local';
        var msgs = h('div.ai-msgs', { 'aria-live': 'polite' });
        var input = h('textarea.ai-chat-input', { rows: 1, maxlength: '2000', placeholder: local ? 'Чат работает только с ИИ' : 'Спроси про план…', 'aria-label': 'Вопрос ИИ', disabled: local || !!S.asking });
        var send = h('button', { type: 'button', class: 'ai-send', 'aria-label': 'Отправить', html: G.icon('send', { size: 18 }), disabled: true });
        function canSend() { return !local && !S.asking && input.value.trim().length > 0; }
        function updSend() { send.disabled = !canSend(); }
        function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
        input.addEventListener('input', function () { updSend(); grow(); });
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); if (canSend()) ask(input.value); }
        });
        send.addEventListener('click', function () { if (canSend()) ask(input.value); });
        var suggest = h('div.ai-suggest', SUGGEST.map(function (q) {
          return h('button', { type: 'button', class: 'ai-suggest-chip', disabled: local, onClick: function () { if (!local && !S.asking) ask(q); } }, q);
        }));
        chatRefs = { msgs: msgs, input: input, send: send, suggest: suggest, local: local, updSend: updSend };
        paintChat();
        return h('section.card.ai-chat',
          h('div.ai-card-head', h('div.icon-tile.tone-cyan', ui.icon('message', null, 20)),
            h('div.grow', h('h3.ai-card-title', 'Спросить ИИ'),
              h('p.ai-card-sub', local ? 'Доступно, когда план собирает ИИ' : 'Уточни что-нибудь по плану — ответ учитывает твоё устройство'))),
          local ? h('div.ai-chat-off', ui.icon('lock', null, 16), h('span', 'Чат работает только с ИИ. Подключи ключ Claude, чтобы задавать вопросы.'),
            S.status && S.status.configured ? null : ui.btn({ label: 'Подключить', icon: 'key', variant: 'soft', size: 'sm', onClick: function () { openKeyEditor({ focusKey: true }); } })) : null,
          msgs, local ? null : suggest,
          h('div', { class: ['ai-composer', local ? 'is-off' : null] }, input, send));
      }

      function paintChat() {
        if (!chatRefs) return;
        var c = chatRefs;
        ui.clear(c.msgs);
        S.chat.forEach(function (m) {
          if (m.error) {
            c.msgs.appendChild(h('div.ai-msg.is-err',
              h('div.ai-bubble', ui.icon('alert-circle', null, 16), h('span', m.content),
                m.code === 'AI_AUTH' || m.code === 'AI_NO_KEY'
                  ? h('button', { type: 'button', class: 'link-btn', onClick: function () { openKeyEditor({ focusKey: true }); } }, 'Проверь ключ')
                  : h('button', { type: 'button', class: 'link-btn', disabled: !!S.asking, onClick: function () { retryAsk(m); } }, 'Повторить'))));
            return;
          }
          c.msgs.appendChild(h('div', { class: ['ai-msg', m.role === 'user' ? 'is-user' : 'is-ai'] },
            m.role === 'user' ? null : h('span.ai-avatar', ui.icon('sparkles', null, 14)),
            h('div.ai-bubble', m.content)));
        });
        if (S.asking) {
          c.msgs.appendChild(h('div.ai-msg.is-ai.is-typing', h('span.ai-avatar', ui.icon('sparkles', null, 14)),
            h('div.ai-bubble', { 'aria-label': 'ИИ печатает' }, h('span.ai-dot'), h('span.ai-dot'), h('span.ai-dot'))));
        }
        c.msgs.hidden = !S.chat.length && !S.asking;
        c.suggest.hidden = !!S.chat.length || !!S.asking;
        c.input.disabled = c.local || !!S.asking;
        c.updSend();
      }

      function retryAsk(m) {
        if (S.asking || !S.result) return;   // ask() would not start: keep the error and its «Повторить»
        var i = S.chat.indexOf(m);
        if (i >= 0) S.chat.splice(i, 1);
        var q = m.question;
        // drop the unanswered user turn too (right before its error); ask() re-adds it at the end
        var u = i > 0 ? S.chat[i - 1] : null;
        if (u && u.role === 'user' && !u.error && u.content === q) S.chat.splice(i - 1, 1);
        ask(q);
      }

      function ask(q) {
        q = String(q || '').trim();
        if (!q || S.asking || !S.result) return;
        var r = S.result;
        var history = S.chat.filter(function (m) { return !m.error; }).map(function (m) { return { role: m.role, content: m.content }; });
        S.chat.push({ role: 'user', content: q });
        S.asking = { question: q };
        if (chatRefs) { chatRefs.input.value = ''; chatRefs.input.style.height = 'auto'; }
        persist();
        paintChat();
        scrollChat();
        A.ask({ history: history, question: q, context: r.context, plan: r.plan, model: S.status && S.status.model }).then(function (a) {
          // a new plan replaced this conversation: only unlock its chat
          if (S.result !== r) { S.asking = null; if (mounted && mounted.chat) mounted.chat(); return; }
          S.asking = null;
          S.chat.push({ role: 'assistant', content: a.text });
          if (typeof a.costUsd === 'number') S.chatCost += a.costUsd;
          persist();
          if (mounted && mounted.chat) mounted.chat();
        }, function (e) {
          e = errOf(e);
          if (S.result !== r) { S.asking = null; if (mounted && mounted.chat) mounted.chat(); return; }
          S.asking = null;
          S.chat.push({ role: 'assistant', error: true, content: e.message, code: e.code, question: q });
          persist();
          if (mounted && mounted.chat) mounted.chat();
        });
      }
      function scrollChat() {
        if (!chatRefs) return;
        var last = chatRefs.msgs.lastElementChild;
        if (last) { try { last.scrollIntoView({ block: 'nearest', behavior: ui.reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ } }
      }

      /* ------------------------------------------------------------ apply */
      function applyPlan() {
        var r = S.result;
        if (!r) return null;
        var tw = liveTweaks();
        var chosen = r.plan.steps.filter(function (s) { return included(s, tw[s.tweakId]); });
        if (!chosen.length) { ui.toast('Отметь хотя бы один шаг', { tone: 'info' }); return null; }
        var flow = app.stepDialog({
          title: 'Применяю план', icon: 'sparkles', phase: 'Применяю шаги плана…',
          items: chosen.map(function (s) { return { title: (tw[s.tweakId] && tw[s.tweakId].title) || s.tweakId }; })
        });
        var tally = { done: 0, manual: 0, skipped: 0, error: 0, admin: 0, reboot: false };
        var include = new Set(chosen.map(function (s) { return s.tweakId; }));
        return A.apply(r.plan, {
          include: include, context: r.context,
          onStep: function (ev) {
            var i = ev.index;
            if (ev.status === 'running') { flow.progress(i); flow.set(i, 'run', 'Применяю…'); return; }
            var t = tw[ev.tweakId];
            if (ev.status === 'done') {
              tally.done++;
              if (t && t.kind === 'action') app.markRan(t.id);
              if (ev.needsReboot) { tally.reboot = true; app.setReboot(true); }
              flow.set(i, 'ok', ev.message);
            } else if (ev.status === 'manual') {
              tally.manual++;
              flow.set(i, 'manual', 'Сделай это в настройках сам.', t ? h('button', {
                type: 'button', class: 'link-btn',
                onClick: function () { app.applyTweak(t, true).then(function (res) { if (res && res.message) ui.toast(res.message, { tone: 'info' }); }); }
              }, 'Открыть настройки') : null);
            } else if (ev.status === 'needs-permission') {
              tally.skipped++;
              flow.set(i, 'warn', ev.message, h('button', {
                type: 'button', class: 'link-btn',
                onClick: function () { host.openSettings({ target: 'dnd_access' }).catch(app.handleError); }
              }, 'Разрешить'));
            } else if (ev.status === 'skipped') {
              tally.skipped++;
              if (/администратор/i.test(ev.message || '') || ev.code === 'NEEDS_ADMIN') tally.admin++;
              flow.set(i, 'skip', ev.message);
            } else {
              tally.error++;
              flow.set(i, 'err', ev.message);
            }
            flow.progress(i + 1);
          }
        }).then(function () {
          return app.tweaks(true).catch(function () { return null; });
        }).then(function () {
          var notes = [];
          if (tally.manual) notes.push(app.sumNote('external-link', 'Шаги «Вручную» GinN не меняет сам: кнопка «Открыть» ведёт прямо на нужный экран.'));
          if (tally.admin) notes.push(app.sumNote('shield', 'Шаги с пометкой «Админ» заработают после перезапуска GinN от имени администратора.'));
          if (tally.reboot) notes.push(app.sumNote('rotate-ccw', 'Часть изменений заработает после перезагрузки.'));
          notes.push(app.sumNote('rotate-ccw', 'Передумал? «Настройки» → «Откатить все изменения».'));
          var actions = [];
          if (tally.admin && app.canElevate()) actions.push({ label: 'Права администратора', icon: 'shield', variant: 'ghost', onClick: function () { setTimeout(function () { app.promptAdmin(); }, 260); } });
          actions.push({ label: 'Готово', variant: 'primary', autofocus: true });
          var st = app.optState();
          flow.finish({
            phase: tally.error ? 'Готово, но не всё получилось' : 'План применён',
            headline: 'Оптимизация: ' + st.pct + '%',
            errors: tally.error > 0,
            cells: [
              { n: tally.done, label: 'применено', tone: 'good' },
              { n: tally.manual, label: 'вручную', tone: 'cyan' },
              { n: tally.skipped, label: 'пропущено', tone: 'muted' },
              { n: tally.error, label: fmt.plural(tally.error, 'ошибка', 'ошибки', 'ошибок'), tone: 'bad' }
            ],
            notes: notes,
            actions: actions
          });
          ui.toast(tally.done ? 'План применён: ' + fmt.count(tally.done, 'шаг', 'шага', 'шагов') : 'План разобран — остальное вручную', { tone: tally.error ? 'warn' : 'good' });
          // done steps leave the selection
          S.include = {};
          persist();
          rerender();
        }, function (e) {
          flow.dlg.close();
          app.handleError(e);
        });
      }

      /* ------------------------------------------------------------ lifecycle */
      offs.push(G.bus.on('ui:ai', function (st) { if (st) { S.status = st; render(); } }));

      return {
        unmount: function () {
          alive = false;
          clearInterval(timer);
          offs.forEach(function (f) { f(); });
          if (mounted === page) mounted = null;
        },
        back: function () {
          if (S.error) { S.error = null; render(); return true; }
          if (S.view === 'plan' && S.result && !S.busy) { toForm(); return true; }
          // a request out to Claude stays out (Back goes to Главная); only «Изменить» withdraws it
          return false;
        },
        refresh: function () {
          // host:resume also fires on every window focus (desktop): re-render only when the AI status changed.
          A.status().then(function (st) {
            if (!alive) return;
            var old = S.status || {};
            var changed = old.configured !== st.configured || old.model !== st.model || old.transport !== st.transport || old.available !== st.available;
            S.status = st;
            if (changed && !S.busy) render();
            offerClipboard();
          });
        }
      };
    }
  };

  /* Shared with Главная / Настройки. */
  G.aiUi = {
    MODEL_UI: MODEL_UI,
    modelName: modelName,
    modelShort: modelShort,
    modelPicker: modelPicker,
    openKeyEditor: openKeyEditor,
    removeKey: removeKey,
    lastResult: function () { return S.result; },
    busy: function () { return !!S.busy; },
    waitingForClaude: waitingForClaude,
    setStatus: function (st) { S.status = st; },
    usd: usd
  };
})(window.GinN);
