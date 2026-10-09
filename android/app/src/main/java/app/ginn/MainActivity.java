package app.ginn;

import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.util.regex.Pattern;

/** Full-screen WebView with the shared GinN UI served from APK assets. */
public final class MainActivity extends Activity {
    private static final String TAG = "GinN";
    private static final int BG = 0xFF07080D;

    private static final String JS_RESUME = "window.__ginnEvent&&window.__ginnEvent({type:'resume'})";
    /** "true" only when the UI handled Back (closed a sheet, left a sub-view). */
    private static final String JS_BACK =
            "(function(){try{return !!(window.__ginnBack&&window.__ginnBack()===true)}catch(e){return false}})()";
    private static final long BACK_TIMEOUT_MS = 1500;
    /** Anything shaped like an Anthropic API key is cut out of page console messages before they reach logcat. */
    private static final Pattern API_KEY = Pattern.compile("sk-ant-[A-Za-z0-9_\\-]+");

    private WebView web;
    private Bridge bridge;
    private AssetServer assets;
    private Object backCallback; // OnBackInvokedCallback on API 33+
    private long backPendingSince;
    private boolean assetFallbackUsed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(BG);
        assets = new AssetServer(getAssets());

        final boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;

        try {
            // inside the guard: this static call loads the WebView provider too and throws the same way when it is missing
            if (debuggable) WebView.setWebContentsDebuggingEnabled(true);
            web = new WebView(this);
        } catch (RuntimeException e) {
            // WebView provider missing or being updated: say so instead of crashing
            Log.e(TAG, "WebView unavailable", e);
            showFatal();
            return;
        }
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        configure(web.getSettings());
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome(debuggable));

        bridge = new Bridge(this, web);
        web.addJavascriptInterface(bridge, Bridge.JS_NAME);

        setContentView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        if (Build.VERSION.SDK_INT >= 33) backCallback = Api33.registerBack(this, this::handleBack);

        web.loadUrl(AssetServer.INDEX_URL);
    }

    private static void configure(WebSettings s) {
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        // GinN AI: the page calls https://api.anthropic.com itself (fetch from the bundled SDK). With the INTERNET
        // permission this is already the default; said explicitly so nothing silently blocks those requests.
        try {
            s.setBlockNetworkLoads(false);
        } catch (SecurityException e) {
            Log.w(TAG, "network loads stay blocked: no INTERNET permission");
        }
    }

    private void showFatal() {
        TextView t = new TextView(this);
        t.setText("Не получилось запустить встроенный браузер Android (WebView).\n\n"
                + "Обнови «Android System WebView» или «Google Chrome» в Play Маркете и открой GinN снова.");
        t.setTextColor(Color.parseColor("#EEF1F8"));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        t.setGravity(Gravity.CENTER);
        int pad = Math.round(24 * getResources().getDisplayMetrics().density);
        t.setPadding(pad, pad, pad, pad);
        t.setBackgroundColor(BG);
        setContentView(t);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.resumeTimers();
            web.onResume();
            web.evaluateJavascript(JS_RESUME, null);
        }
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.onPause();
            // Stop all JS timers (stats polling, animations) while a game runs: GinN must not eat CPU in background.
            web.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            Api33.unregisterBack(this, backCallback);
            backCallback = null;
        }
        destroyWebView();
        super.onDestroy();
    }

    private void destroyWebView() {
        if (bridge != null) {
            bridge.destroy();
            bridge = null;
        }
        if (web != null) {
            WebView w = web;
            web = null;
            w.removeJavascriptInterface(Bridge.JS_NAME);
            if (w.getParent() instanceof ViewGroup) ((ViewGroup) w.getParent()).removeView(w);
            w.destroy();
        }
    }

    // ---------------------------------------------------------------- Back

    /** API < 33. On 33+ the OnBackInvokedCallback below receives Back (enableOnBackInvokedCallback="true"). */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (web == null) {
            finish();
            return;
        }
        long now = SystemClock.uptimeMillis();
        if (backPendingSince != 0) {
            // the page has not answered the previous Back yet; if it hangs, let the user out anyway
            if (now - backPendingSince > BACK_TIMEOUT_MS) {
                backPendingSince = 0;
                finish();
            }
            return;
        }
        backPendingSince = now;
        web.evaluateJavascript(JS_BACK, result -> {
            backPendingSince = 0;
            if (!"true".equals(result) && !isFinishing()) finish();
        });
    }

    @TargetApi(33)
    private static final class Api33 {
        static Object registerBack(Activity activity, Runnable onBack) {
            OnBackInvokedCallback cb = onBack::run;
            activity.getOnBackInvokedDispatcher()
                    .registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
            return cb;
        }

        static void unregisterBack(Activity activity, Object cb) {
            activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((OnBackInvokedCallback) cb);
        }
    }

    // ---------------------------------------------------------------- WebChromeClient

    /** Page console -> logcat only in debug builds, and never with anything that looks like an API key. */
    private static final class Chrome extends WebChromeClient {
        private final boolean debuggable;

        Chrome(boolean debuggable) {
            this.debuggable = debuggable;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            if (debuggable && m != null) {
                Log.d(TAG + "-web", redact(m.message()) + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            }
            return true; // handled: WebView must not log the raw message itself
        }
    }

    static String redact(String s) {
        return s == null ? "" : API_KEY.matcher(s).replaceAll("sk-ant-…");
    }

    // ---------------------------------------------------------------- WebViewClient

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            // Only our own origin is answered here. Everything else (GinN AI: fetch to https://api.anthropic.com
            // from the bundled SDK, allowed by the page CSP) goes to the network untouched.
            Uri url = request.getUrl();
            if (AssetServer.isAppUrl(url)) return assets.serve(url);
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (AssetServer.isAppUrl(url) || AssetServer.isAssetFileUrl(url)) return false;
            if (request.isForMainFrame()) openExternally(url);
            return true; // never navigate the app WebView away from the bundled UI
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            // Safety net: if the WebView ever refuses our https asset origin for the page itself, load the same
            // UI from file:///android_asset/ (always readable, even with file access off). The UI works there too.
            if (request.isForMainFrame() && AssetServer.isAppUrl(request.getUrl()) && !assetFallbackUsed) {
                assetFallbackUsed = true;
                Log.w(TAG, "UI load failed (" + error.getErrorCode() + " " + error.getDescription()
                        + "), using " + AssetServer.FILE_INDEX_URL);
                view.loadUrl(AssetServer.FILE_INDEX_URL);
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The renderer crashed or was killed for memory: this WebView is dead, rebuild the screen.
            Log.w(TAG, "WebView renderer gone, crashed=" + detail.didCrash());
            if (view == web) {
                destroyWebView();
                recreate();
            }
            return true;
        }
    }

    private void openExternally(Uri url) {
        Intent intent = Screens.externalIntent(url.toString());
        if (intent == null) return;
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException e) {
            Log.w(TAG, "No app for " + url.getScheme());
        }
    }
}
