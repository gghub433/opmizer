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

Capabilities strings: `tweaks`, `games.detect`, `games.launch`, `games.profile` (PC writes game configs),
`boost` (Android RAM boost), `dnd`, `saveFile`, `admin` (Windows elevation available).

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
- Nav: Главная (`#/dashboard`), Оптимизация (`#/optimize`), Игры (`#/games`), Мониторинг (`#/monitor`), Настройки (`#/settings`).
- Motion: 150–250 ms ease transitions, ring gauge animates, respect `prefers-reduced-motion`.
- Toasts bottom-center (mobile) / bottom-right (desktop). Sheets slide from bottom on mobile, centered modal on desktop.
