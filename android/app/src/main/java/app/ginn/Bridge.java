package app.ginn;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.Html;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * window.GinNAndroid.call(id, method, argsJson). Work runs on a small background pool; the answer
 * ({"ok":true,"data":…} or {"ok":false,"code":…,"error":…}) goes back through window.__ginnResolve(id, payload)
 * on the UI thread. No exception ever escapes to the WebView.
 */
final class Bridge {
    static final String JS_NAME = "GinNAndroid";
    private static final String TAG = "GinN";

    /** readText: at most 200 KB of text, the whole call within 3 s (up to 2 s of it waiting for window focus). */
    static final int MAX_CLIP_CHARS = 200 * 1024;
    private static final long CLIP_TIMEOUT_MS = 3000;
    private static final long CLIP_FOCUS_WAIT_MS = 2000;
    private static final long CLIP_FOCUS_POLL_MS = 100;
    static final String MSG_CLIP_FAILED = "Не удалось прочитать буфер обмена";
    static final String MSG_CLIP_FOREIGN_PAGE = "Буфер обмена доступен только интерфейсу GinN";

    private final Host host;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool;
    private final Stats stats = new Stats();
    private volatile boolean destroyed;

    Bridge(Activity activity, WebView web) {
        this.host = new Host(activity);
        this.web = web;
        final AtomicInteger n = new AtomicInteger();
        ThreadFactory factory = r -> {
            Thread t = new Thread(r, "ginn-bridge-" + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
        // a few threads so a slow call (games list with icons) never blocks the 1.5 s stats polling
        this.pool = Executors.newFixedThreadPool(3, factory);
    }

    @JavascriptInterface
    public void call(String id, String method, String argsJson) {
        final String callId = id == null ? "" : id;
        try {
            pool.execute(() -> deliver(callId, handle(method, argsJson)));
        } catch (Throwable t) {
            deliver(callId, failure(HostException.FAILED, "GinN сейчас занят, попробуй ещё раз"));
        }
    }

    void destroy() {
        destroyed = true;
        pool.shutdownNow();
    }

    /** Runs one call and returns the JSON payload string. Never throws. */
    String handle(String method, String argsJson) {
        try {
            JSONObject args = parseArgs(argsJson);
            Object data = dispatch(method == null ? "" : method, args);
            JSONObject ok = new JSONObject();
            ok.put("ok", true);
            ok.put("data", data == null ? JSONObject.NULL : data);
            return ok.toString();
        } catch (HostException e) {
            return failure(e.code, e.getMessage());
        } catch (SecurityException e) {
            logFailure(method, e);
            return failure(HostException.NEEDS_PERMISSION, "Android не дал на это разрешения");
        } catch (Throwable t) {
            logFailure(method, t);
            return failure(HostException.FAILED, "Не получилось: внутренняя ошибка (" + t.getClass().getSimpleName() + ")");
        }
    }

    /** AI calls carry the API key: for them only the exception class is logged, never a message or stack. */
    private static void logFailure(String method, Throwable t) {
        if (isAiMethod(method)) {
            Log.w(TAG, method + " failed: " + t.getClass().getSimpleName());
        } else {
            Log.w(TAG, method + " failed", t);
        }
    }

    static boolean isAiMethod(String method) {
        return method != null && method.startsWith("ai");
    }

    private Object dispatch(String method, JSONObject args) throws Exception {
        switch (method) {
            case "info":
                return info();
            case "hardware":
                return HardwareInfo.read(host);
            case "stats":
                return stats.read(host);
            case "tweaks":
                return Tweaks.list(host);
            case "applyTweak":
                return Tweaks.apply(host, str(args, "id"), args.optBoolean("enable", true));
            case "revertAll":
                return Tweaks.revertAll(host);
            case "games":
                return Games.list(host, args.optJSONArray("knownPackages"));
            case "launchGame":
                return Games.launch(host, str(args, "id"), args.optBoolean("boost", false));
            case "applyGameProfile":
                throw new HostException(HostException.UNSUPPORTED,
                        "На Android GinN не может менять настройки игр — выставь их вручную по подсказкам");
            case "revertGameProfile":
                throw new HostException(HostException.UNSUPPORTED,
                        "На Android GinN не меняет файлы игр, поэтому откатывать нечего");
            case "relaunchAsAdmin":
                throw new HostException(HostException.UNSUPPORTED, "Права администратора нужны только в версии для Windows");
            case "saveFile":
                return Files.save(host, str(args, "name"), str(args, "base64"), str(args, "mime"),
                        args.optBoolean("open", false));
            case "copyText":
                return copyText(str(args, "text"));
            case "readText":
                return readText();
            case "openSettings":
                return Screens.open(host, str(args, "target"));
            case "openExternal":
                return Screens.openExternal(host, str(args, "url"));
            case "aiStatus":
                return Ai.status(Ai.prefs(host.app));
            case "aiConfigure":
                return Ai.configure(Ai.prefs(host.app), args);
            case "aiClear":
                return Ai.clear(Ai.prefs(host.app));
            case "aiKey":
                if (!pageIsOurs()) throw new HostException(HostException.UNSUPPORTED, Ai.MSG_FOREIGN_PAGE);
                return Ai.key(Ai.prefs(host.app));
            case "aiMessage":
                throw new HostException(HostException.UNSUPPORTED, Ai.MSG_PAGE_ONLY);
            default:
                throw new HostException(HostException.UNSUPPORTED, "Эта функция недоступна на Android");
        }
    }

    private JSONObject info() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("platform", "android");
        o.put("appVersion", host.appVersion());
        o.put("sdk", Build.VERSION.SDK_INT);
        // GinN AI runs the Claude SDK (ES2020) inside the WebView: Chrome/WebView 80+ is needed. Reported so the UI
        // can tell "update Android System WebView" apart from other failures.
        String wv = webViewVersion();
        o.put("webViewVersion", wv != null ? wv : JSONObject.NULL);
        JSONArray caps = new JSONArray();
        caps.put("tweaks");
        caps.put("games.detect");
        caps.put("games.launch");
        if (Booster.canKillOthers()) caps.put("boost"); // Android 14+ forbids killing other apps' processes
        caps.put("dnd");
        caps.put("saveFile");
        caps.put("ai"); // Claude requests run in the page (transport 'page'); the app only keeps the key
        o.put("capabilities", caps);
        return o;
    }

    static String webViewVersion() {
        try {
            PackageInfo p = WebView.getCurrentWebViewPackage();
            return p != null && p.versionName != null ? p.versionName : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private JSONObject copyText(String text) throws Exception {
        final String value = text == null ? "" : text;
        Host.onUi(() -> {
            ClipboardManager cm = (ClipboardManager) host.app.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) throw new HostException(HostException.UNSUPPORTED, "Буфер обмена недоступен");
            cm.setPrimaryClip(ClipData.newPlainText("GinN", value));
            return null;
        });
        return new JSONObject();
    }

    /**
     * Clipboard text for the «via Claude app» mode ({"text": "…"}, "" when empty, not text or denied by Android).
     * Android 10+ lets an app read the clipboard only while its window has input focus. The call comes from the
     * visible page, but right after switching back from the Claude app the focus can arrive a moment later,
     * so (off the UI thread) we wait for it briefly, then read on the UI thread. The content is never logged.
     */
    private JSONObject readText() throws Exception {
        final long start = nowMs();
        String text;
        try {
            // the UI thread cannot wait for its own focus change, so only pool threads wait
            if (Looper.myLooper() != Looper.getMainLooper()) awaitWindowFocus(start + CLIP_FOCUS_WAIT_MS);
            // one UI-thread hop for both checks, so a stuck UI thread still answers within the 3 s budget
            text = Host.onUi(() -> {
                // the clipboard may hold passwords: like aiKey, only the bundled GinN UI may read it (null = refuse)
                if (destroyed || !isOurUrl(web.getUrl())) return null;
                ClipboardManager cm = (ClipboardManager) host.app.getSystemService(Context.CLIPBOARD_SERVICE);
                return cm == null ? "" : clipText(cm.getPrimaryClip(), MAX_CLIP_CHARS);
            }, start + CLIP_TIMEOUT_MS - nowMs());
            if (text == null) throw new HostException(HostException.UNSUPPORTED, MSG_CLIP_FOREIGN_PAGE);
        } catch (HostException e) {
            if (HostException.UNSUPPORTED.equals(e.code)) throw e;
            Log.w(TAG, "readText failed: timeout");
            throw new HostException(HostException.FAILED, MSG_CLIP_FAILED);
        } catch (SecurityException e) {
            text = ""; // some vendor builds throw instead of returning null when the app is not focused
        } catch (Exception e) {
            Log.w(TAG, "readText failed: " + e.getClass().getSimpleName());
            throw new HostException(HostException.FAILED, MSG_CLIP_FAILED);
        }
        JSONObject o = new JSONObject();
        o.put("text", text == null ? "" : text);
        return o;
    }

    /** Monotonic real-time milliseconds (keeps ticking in Robolectric too, unlike the Android uptime clock). */
    private static long nowMs() {
        return System.nanoTime() / 1_000_000L;
    }

    /** Polls (from a pool thread) until GinN's window has focus or {@code until} ({@link #nowMs()}) passes. */
    private void awaitWindowFocus(long until) {
        while (!destroyed) {
            long left = until - nowMs();
            if (left <= 0) return;
            try {
                if (Boolean.TRUE.equals(Host.onUi(host::hasWindowFocus, left))) return;
            } catch (Exception e) {
                return; // the read below reports whatever is wrong
            }
            if (until - nowMs() <= CLIP_FOCUS_POLL_MS) return;
            try {
                Thread.sleep(CLIP_FOCUS_POLL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /**
     * Plain text of a clip: text items joined by line breaks, HTML-only items converted to text, other items
     * (URIs, intents) skipped. Capped at {@code maxChars} without splitting a surrogate pair. Never null.
     */
    static String clipText(ClipData clip, int maxChars) {
        if (clip == null || maxChars <= 0) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < clip.getItemCount() && sb.length() <= maxChars; i++) {
            ClipData.Item item = clip.getItemAt(i);
            if (item == null) continue;
            CharSequence t = item.getText();
            if (t == null && item.getHtmlText() != null) {
                t = trimEnd(Html.fromHtml(item.getHtmlText(), Html.FROM_HTML_MODE_LEGACY)); // drops the </p> breaks
            }
            if (t == null || t.length() == 0) continue;
            if (sb.length() > 0) sb.append('\n');
            sb.append(t, 0, Math.min(t.length(), Math.max(0, maxChars + 1 - sb.length())));
        }
        return capChars(sb.toString(), maxChars);
    }

    private static CharSequence trimEnd(CharSequence t) {
        int end = t.length();
        while (end > 0 && Character.isWhitespace(t.charAt(end - 1))) end--;
        return t.subSequence(0, end);
    }

    static String capChars(String s, int max) {
        if (s == null) return "";
        if (s.length() <= max) return s;
        int end = max;
        if (end > 0 && Character.isHighSurrogate(s.charAt(end - 1))) end--;
        return s.substring(0, end);
    }

    /**
     * Defence in depth for aiKey: the key is handed out only while the WebView shows the bundled GinN UI
     * (navigation away from it is blocked anyway, see MainActivity.Client).
     */
    private boolean pageIsOurs() {
        String url;
        try {
            url = Host.onUi(() -> destroyed ? null : web.getUrl());
        } catch (Exception e) {
            return false;
        }
        return isOurUrl(url);
    }

    /** True for the bundled GinN UI (appassets https URL or its file:// fallback); used by aiKey and readText. */
    static boolean isOurUrl(String url) {
        if (url == null) return false;
        Uri u = Uri.parse(url);
        return AssetServer.isAppUrl(u) || AssetServer.isAssetFileUrl(u);
    }

    // ---------------------------------------------------------------- wire helpers (pure, unit-tested)

    static JSONObject parseArgs(String argsJson) throws HostException {
        if (argsJson == null) return new JSONObject();
        String s = argsJson.trim();
        if (s.isEmpty() || s.equals("null") || s.equals("undefined")) return new JSONObject();
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            throw new HostException(HostException.FAILED, "Некорректные параметры вызова");
        }
    }

    /** String argument or null (missing / JSON null). */
    static String str(JSONObject args, String key) {
        Object v = args.opt(key);
        if (v == null || v == JSONObject.NULL) return null;
        return v.toString();
    }

    static String failure(String code, String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("code", code == null ? HostException.FAILED : code);
            o.put("error", message == null ? "Неизвестная ошибка" : message);
            return o.toString();
        } catch (JSONException e) {
            return "{\"ok\":false,\"code\":\"FAILED\",\"error\":\"Внутренняя ошибка\"}";
        }
    }

    /** JS source that settles the pending promise: window.__ginnResolve("<id>", "<payload JSON>"). */
    static String resolveScript(String id, String payload) {
        return "window.__ginnResolve&&window.__ginnResolve(" + jsString(id) + "," + jsString(payload) + ")";
    }

    /** JSON string literal that is also a safe JS literal (U+2028/2029 escaped for older JS engines). */
    static String jsString(String s) {
        return JSONObject.quote(s == null ? "" : s).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    private void deliver(final String id, final String payload) {
        if (destroyed) return;
        final String js = resolveScript(id, payload);
        main.post(() -> {
            if (destroyed) return;
            try {
                web.evaluateJavascript(js, null);
            } catch (RuntimeException e) {
                Log.w(TAG, "evaluateJavascript failed", e);
            }
        });
    }
}
