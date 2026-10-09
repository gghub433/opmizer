# GinN — architecture contract

GinN is a game optimizer for **Android phones** and **Windows PCs** (in the spirit of HONE):
one-click optimization, a hardware dashboard, live monitoring, per-game FPS targets and
"potato" graphics profiles. All user-facing text is **Russian**.

One shared web UI (`ui/`) runs inside two native hosts:

| Platform | Host | How UI is loaded | Native bridge |
|---|---|---|---|
| Android 10+ (APK) | `android/` — Java, WebView | `https://appassets.androidplatform.net/assets/index.html` served from APK assets (= `ui/`) by our own `shouldInterceptRequest` (no androidx deps) | `window.GinNAndroid.call(id, method, argsJson)` (async, results via `window.__ginnResolve`) |
| Windows 10/11 (exe) | `desktop/` — Electron | `desktop/renderer/index.html` (copy of `ui/`, made by `npm run sync-ui`) | `window.ginnDesktop.call(method, args)` → `ipcRenderer.invoke('ginn', method, args)` |
| Browser (dev/tests) | none | serve `ui/` over http | `ui/js/mock.js` fake host, flavour via `?platform=android` (default) or `?platform=windows` |

## Repository layout

```
ui/                         shared SPA — plain ES2020, NO modules, NO build step, NO CDN (works offline + file://)
  index.html                loads every script below with classic <script src> tags, in this order
  assets/logo.svg           brand logo (given, do not change)
  css/ginn.css              design system + all component/page styles
  js/core.js                window.GinN namespace, tiny helpers (h(), $, fmt), event bus, toast(), modal()
  js/host.js                host adapter -> GinN.host (Promise API, see below). Picks Android / Desktop / mock.
  js/mock.js                mock host (android + windows flavours), stateful, realistic fake data
  js/data/devices.js        GinN.devices: tier/score computation from hardware, tier caps, SoC/CPU/GPU tables
  js/data/games.js          GinN.games: game catalog (mobile + pc), recipes, fps caps, fpsLimit()
  js/lib/mcpack.js          GinN.mcpack.build() -> Uint8Array zip of the gray Bedrock texture pack
  js/ui/icons.js            GinN.icon(name) -> inline SVG string (lucide-style 24x24 strokes)
  js/ui/components.js       shared components: ring gauge, sparkline (canvas), toggle, card, chips, sheet
  js/pages/dashboard.js     GinN.pages.dashboard
  js/pages/optimize.js      GinN.pages.optimize
  js/pages/games.js         GinN.pages.games  (list + game detail view)
  js/pages/monitor.js       GinN.pages.monitor
  js/pages/settings.js      GinN.pages.settings
  js/pages/ai.js            GinN.pages.ai  (AI optimizer: key onboarding, goal, plan review/apply, chat)
  js/ai/advisor.js          GinN.ai: context collection, request building, transport, validation, apply, localPlan
  js/vendor/anthropic-sdk.js  official @anthropic-ai/sdk bundled as IIFE (global AnthropicSDK) — generated, do not edit
  js/app.js                 boot: shell (sidebar / bottom tabs), router (#/dashboard ...), start
android/                    Gradle project (AGP 8.5.2, compileSdk 34, minSdk 29, Java 17, no Kotlin, no androidx)
  app/build.gradle          assets.srcDirs = ['../../ui']
  app/src/main/java/app/ginn/MainActivity.java   WebView + asset server + back handling + events
  app/src/main/java/app/ginn/Bridge.java         @JavascriptInterface call(id, method, argsJson)
  app/src/main/java/app/ginn/*.java              helpers (HardwareInfo, Tweaks, Games, ...)
desktop/                    Electron app
  package.json              electron 44.x, electron-builder 26.x, systeminformation 5.x
  main.js                   window + IPC dispatcher
  preload.js                contextBridge -> window.ginnDesktop
  src/*.js                  run.js (execFile wrapper), reg.js, admin.js, state.js, hardware.js, tweaks.js,
                            games.js, gamecfg/*.js, zip.js, png.js
  test/*.test.js            node:test unit tests (pure logic, exec mocked)
  scripts/sync-ui.js        copies ../ui -> renderer/
  build/icon.png            512x512 app icon (rendered from ui/assets/logo.svg)
.github/workflows/build.yml APK (ubuntu) + Windows exe (windows-latest) + GitHub release `ginn-latest`
release/                    GinN.apk committed for easy download
```

## Host API (`GinN.host`)

Every method returns a `Promise`. On failure it rejects with an `Error` that has `.code`
(e.g. `NEEDS_PERMISSION`, `NEEDS_ADMIN`, `UNSUPPORTED`, `NOT_FOUND`, `FAILED`) and a Russian `.message`.

Wire format (Android and Electron): the native side always answers
`{"ok":true,"data":<any>}` or `{"ok":false,"code":"...","error":"<russian message>"}`.

Android wire details: JS calls `GinNAndroid.call(String id, String method, String argsJson)`; Java runs it
on a background executor and then, on the UI thread, runs
`window.__ginnResolve(<id as JS string>, <payload as JSON-quoted string>)`. `host.js` defines
`window.__ginnResolve`, parses the payload string and settles the pending promise.
Native → JS events: `window.__ginnEvent({type:'resume'})` (Activity onResume — UI refreshes states).
Back button: Java evaluates `window.__ginnBack && window.__ginnBack()`; result `"true"` = handled by UI
(closed a sheet / went back a view), anything else → `finish()`.

| method | args | returns `data` |
|---|---|---|
| `info` | – | `{platform:'android'|'windows'|'web', appVersion:'1.0.0', isAdmin?:bool, capabilities:string[]}` |
| `hardware` | – | **Hardware** (below). Static-ish; UI caches it. |
| `stats` | – | **Stats** (below). Cheap; UI polls every 1500 ms while Dashboard/Monitor is visible. |
| `tweaks` | – | **Tweak[]** with current `state` |
| `applyTweak` | `{id, enable:bool}` | `{id, state, message?, needsReboot?:bool}` (for `kind:'action'` `enable` is ignored and `message` describes the result, e.g. "Освобождено 412 МБ"; for `kind:'link'` it opens the system screen and returns `{id, state, message:'Открыты настройки'}`) |
| `revertAll` | – | `{reverted:string[], failed:[{id,error}]}` restores every backup made by GinN (tweaks + game profiles) |
| `games` | `{knownPackages?:string[]}` (Android: all package ids from catalog) | **InstalledGame[]** |
| `launchGame` | `{id, boost:bool}` (`id` = InstalledGame.id) | `{message}` |
| `applyGameProfile` | `{gameId, fps, preset:'potato'|'balanced', grayTextures:bool}` | `{written:string[] (file paths), message}` — PC only for catalog games with `pc.profile:true`; Android rejects with `UNSUPPORTED` |
| `revertGameProfile` | `{gameId}` | `{message}` |
| `saveFile` | `{name, base64, mime, open:bool}` | `{path}` Android: MediaStore Downloads (+ ACTION_VIEW if open); Windows: Downloads folder (+ shell.openPath if open) |
| `copyText` | `{text}` | `{}` |
| `openSettings` | `{target}` | `{}` targets: android `developer`, `battery_saver`, `display`, `dnd_access`, `storage`, `app_details:<pkg>`; windows `graphics`, `gamemode`, `power`, `startup`, `storage` |
| `relaunchAsAdmin` | – | `{}` (Windows only; app restarts elevated) |
| `openExternal` | `{url}` | `{}` |
| `aiStatus` | – | `{configured:bool, model:string, transport:'native'|'page'|'mock'}` |
| `aiConfigure` | `{key?:string, model?:string}` | same as `aiStatus` (key is stored on the device only, never returned) |
| `aiClear` | – | same as `aiStatus` (forgets the key) |
| `aiKey` | – | `{key}` — **only** hosts with `transport:'page'` (Android, browser); desktop rejects with `UNSUPPORTED` |
| `aiMessage` | `{params}` (Messages API request body built by `GinN.ai`) | the raw Message object — **only** desktop (`transport:'native'`, Electron main uses `@anthropic-ai/sdk`) |
| `readText` | – | `{text}` — current clipboard text (used to paste Claude's answer in the «via Claude app» mode; may be `''`) |

Capabilities strings: `tweaks`, `games.detect`, `games.launch`, `games.profile` (PC writes game configs),
`boost` (Android RAM boost), `dnd`, `saveFile`, `admin` (Windows elevation available), `ai` (all hosts),
`ai.native` (desktop: requests go through Electron main).

## GinN AI (Claude)

The AI optimizer uses the **official Anthropic JS SDK** (`@anthropic-ai/sdk`) with the user's own API key:
- Windows: Electron main process (`desktop/src/ai.js`): `new Anthropic({apiKey})` → `client.beta.messages.create(params)`.
  Key encrypted with Electron `safeStorage` (fallback: plain file in userData, flagged) inside ginn-state.json.
- Android / browser: inside the page with the SDK bundled as a classic script `ui/js/vendor/anthropic-sdk.js`
  (esbuild IIFE, global `AnthropicSDK`, built by `tools/build-sdk-bundle.sh`) →
  `new AnthropicSDK.default({apiKey, dangerouslyAllowBrowser:true})`. Android stores the key in private
  SharedPreferences (`aiConfigure` / `aiKey`). CSP `connect-src 'self' https://api.anthropic.com`.
- Error codes (Russian messages): `AI_NO_KEY`, `AI_AUTH` (401/403), `AI_BILLING` (402), `AI_RATE` (429),
  `AI_BUSY` (5xx/529), `AI_NETWORK` (connection/timeout), `AI_BAD_REQUEST` (400/404/413), `AI_REFUSAL`
  (`stop_reason:"refusal"`), `AI_TRUNCATED` (`stop_reason:"max_tokens"`), `AI_BAD_OUTPUT` (unparseable JSON).

Request (`GinN.ai`, `ui/js/ai/advisor.js`), identical on every platform:
```js
{ model: 'claude-opus-5-5' /* user-selectable: claude-sonnet-5-5, claude-haiku-5-5 */, max_tokens: 16000,
  system: '<stable Russian system prompt>',
  messages: [{ role:'user', content: '<goal + JSON context: hardware (no personal names), class, stats,
             tweaks with states, installed games, chosen game/fps, user note>' }],
  output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
  betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' /* omitted for Haiku */ }
```
No `thinking` field (adaptive thinking is on by default), no forced `tool_choice` (400 on these models).
PLAN_SCHEMA (all objects `additionalProperties:false`, every property required, `tweakId` enum = this device's
tweak ids, `gameId` enum = catalog ids for the platform or null):
`{summary, expectedGain, steps:[{tweakId, enable, reason, priority:'high'|'medium'|'low'}],
  game: {gameId, fps, preset:'potato'|'balanced', reason, settings:[string]} | null, tips:[string], warnings:[string]}`.
`GinN.ai.plan()` validates the result against the live tweak list (unknown ids dropped), returns
`{plan, usage:{input_tokens, output_tokens}, costUsd (approx.), model, source:'ai'|'local'|'demo'}`.
`GinN.ai.apply(plan, {onStep})` applies chosen steps with the same rules as "Optimize all".
`GinN.ai.ask(history, question)` — follow-up chat (plain text answer, same context in the system prompt).
`GinN.ai.localPlan()` — offline rules-based plan (labelled «Базовый анализ без ИИ», never presented as AI).
### Mode «Через приложение Claude» (no API key — works with a free or Pro claude.ai account)

Anthropic does not let third-party apps sign in with claude.ai accounts or use a Claude Free/Pro subscription, so
GinN never asks for claude.ai credentials. Instead it hands the request to the official Claude app/website:
1. `GinN.ai.handoff({goal, gameId, fps, note, context?})` → `{prompt, url}`: a self-contained Russian prompt (rules, the
   device context as compact JSON, the allowed tweak ids, and the exact answer format: a short explanation followed by
   ONE fenced ```json block with the PLAN fields) and `url = 'https://claude.ai/new?q=' + encodeURIComponent(prompt)`
   only when that whole URL is ≤ 2000 chars; otherwise plain `https://claude.ai/new` (Russian prompts always take this
   path — the prompt travels via the clipboard). A pending request is kept in localStorage `ginn.ai.pending` (3 h)
   so the paste step survives the app being killed while the user is in Claude.
   The UI copies `prompt` with `host.copyText` and opens `url` with `host.openExternal` (Claude app or browser).
2. The user sends it in Claude (their own free/Pro account) and copies the whole answer.
3. `GinN.ai.parseAnswer(text, context)` → same result shape as `plan()` with `source:'claude-app'`, `usage:null`,
   `costUsd:null`: extracts the last ```json block (fallback: last balanced `{…}`), JSON.parse, then the same
   normalisation/validation as API plans (unknown tweak ids dropped, fps clamped…). Errors: `AI_BAD_OUTPUT` with a
   Russian hint («Скопируй ответ Claude целиком — с блоком кода в конце»).
The AI page offers this mode by default when no API key is configured; API-key mode stays as «Автоматически (API-ключ)».
The follow-up chat is API-only; in this mode the user simply continues the conversation in Claude.

Mock host: `?aidemo=1` → `transport:'mock'`, `aiMessage` returns a canned Message built from `localPlan` after ~1.5 s
(labelled «Демо»); otherwise mock uses `transport:'page'` with a key saved in localStorage.

### Hardware
```js
{
  device:  { name:'Samsung Galaxy A55', manufacturer:'Samsung', model:'SM-A556B', type:'phone'|'tablet'|'desktop'|'laptop' },
  os:      { name:'Android 14', version:'14', build:'UP1A...' },
  cpu:     { name:'Exynos 1480', cores:8, threads:8, maxMHz:2750, arch:'arm64-v8a' },
  gpu:     { name:'Xclipse 530' | null, vramMB:null|8192 },      // Android sends null name -> UI fills from WebGL
  ram:     { totalMB:7680, availMB:3100 },
  storage: { totalGB:238.4, freeGB:91.2, type:'UFS'|'SSD'|'HDD'|null },
  display: { width:1080, height:2340, refreshHz:60, maxRefreshHz:120 },
  battery: { present:true, level:78, charging:false, tempC:31.5 } | null,
  tier?:   1|2|3|4    // optional; UI computes with GinN.devices.classify(hw) if absent
}
```

### Stats
```js
{ cpuLoad:0-100|null, cpuMHz:number|null, ramUsedPct:0-100, ramAvailMB:number,
  tempC:number|null, tempSource:'cpu'|'battery'|null, batteryLevel:number|null,
  thermal:'none'|'light'|'moderate'|'severe'|'critical'|'emergency'|'shutdown'|null, gpuLoad:number|null }
```

### Tweak
```js
{ id:'power_ultimate', category:'power'|'system'|'graphics'|'network'|'input'|'cleanup'|'android',
  title:'Максимальная производительность', desc:'Включает схему питания «Ultimate Performance».',
  impact:['fps','latency','network','battery','temps','ram','storage'], // what it improves
  kind:'toggle'|'action'|'link', state:'on'|'off'|'unknown',
  recommended:bool, requiresAdmin:bool, requiresReboot:bool, risk:'safe'|'moderate' }
```
"Optimize all" = UI calls `applyTweak({id, enable:true})` sequentially for every `recommended` tweak
with `kind!=='link'` and `state!=='on'` (skipping `requiresAdmin` ones when `info.isAdmin===false`),
showing per-step progress. Links are never auto-opened.

### InstalledGame
```js
{ id:'com.mojang.minecraftpe' | 'steam:730' | 'minecraft-java' | 'epic:Fortnite',
  name:'Minecraft', catalogId:'minecraft'|null, icon:'data:image/png;base64,...'|null,
  source:'android'|'steam'|'epic'|'riot'|'minecraft'|'roblox' }
```

## Game catalog (`GinN.games`)
```js
GinN.games.list = [{
  id:'minecraft', name:'Minecraft', color:'#5BA33B', glyph:'⛏',
  android:{ packages:['com.mojang.minecraftpe'], fpsCap:144, potato:'mcpack' } | null,
  pc:{ match:{ steam:[730] , epic:['Fortnite'], key:'minecraft-java' }, fpsCap:1000, profile:true } | null,
  recipe:{ android:{ potato:{'Графика':['… {fps} …']}, balanced:{…} }, pc:{ potato:{…}, balanced:{…} } }
}]
GinN.games.fpsLimit(game, hw, platform) -> { max, reasons:[{label:'экран', value:120}...], recommended }
GinN.games.recipe(game, platform, preset, fps) -> [{section, items:[string]}]   // {fps} substituted
GinN.games.byPackage(pkg) / byInstalled(installedGame)
```
FPS limit rules: Android `max = min(display.maxRefreshHz, tierCap[tier], game.android.fpsCap)`,
`tierCap = {1:60, 2:90, 3:120, 4:144}`. Windows: `max = min(game.pc.fpsCap, pcTierCap[tier])`,
`pcTierCap = {1:75, 2:165, 3:300, 4:1000}`, `recommended = min(max, display.maxRefreshHz)` (FPS above the
monitor refresh is allowed on PC — lower input lag). Selectable steps: `[30,45,60,75,90,120,144,165,240,360]`
filtered to `<= max`, plus `max` itself.

## Design system (GinN look)

Dark gaming UI, glassy cards, violet→cyan brand gradient (same as logo).

```
--bg:#07080D  --bg-2:#0B0D14  --surface:#10131C  --surface-2:#161A26  --surface-3:#1D2233
--border:#242A3B  --text:#EEF1F8  --muted:#8A93A8  --faint:#5A6278
--a1:#7C5CFF  --a2:#22D3EE  --grad:linear-gradient(135deg,#7C5CFF,#22D3EE)
--good:#34D399  --warn:#FBBF24  --bad:#F87171
radius 14/18/24, font: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif (no web fonts)
```
- Layout ≥ 900px: fixed left sidebar 232px (logo + "GinN" wordmark with gradient text, nav, footer with
  version + platform badge) and content area max-width 1180px. On Windows host the top 40px is a drag
  region (`-webkit-app-region: drag`, interactive elements `no-drag`) and leaves 140px on the right free
  for the native window buttons (Electron `titleBarOverlay`). Body class `host-windows` / `host-android` / `host-web`.
- Layout < 900px: top app bar (logo + page title) + bottom tab bar (5 tabs, icons + labels), safe-area insets.
- Nav (desktop sidebar, 6 items): Главная (`#/dashboard`), Оптимизация (`#/optimize`), ИИ (`#/ai`), Игры (`#/games`),
  Мониторинг (`#/monitor`), Настройки (`#/settings`). Mobile bottom bar (5 tabs): Главная, Оптимизация, ИИ (centre,
  accented), Игры, Настройки; Мониторинг is reached from the dashboard live-stats card and from Настройки.
- Motion: 150–250 ms ease transitions, ring gauge animates, respect `prefers-reduced-motion`.
- Toasts bottom-center (mobile) / bottom-right (desktop). Sheets slide from bottom on mobile, centered modal on desktop.
