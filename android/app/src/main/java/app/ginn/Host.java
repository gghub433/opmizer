package app.ginn;

import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** What the bridge helpers need from the app: contexts, the UI thread, preferences and activity starts. */
final class Host {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final long UI_TIMEOUT_MS = 5000;

    final Context app;
    private final Activity activity;

    Host(Activity activity) {
        this.activity = activity;
        this.app = activity.getApplicationContext();
    }

    SharedPreferences prefs() {
        return app.getSharedPreferences("ginn", Context.MODE_PRIVATE);
    }

    String appVersion() {
        try {
            PackageInfo pi = packageInfo(app.getPackageManager(), app.getPackageName());
            if (pi.versionName != null) return pi.versionName;
        } catch (PackageManager.NameNotFoundException | RuntimeException ignored) {
            // fall through
        }
        return "1.0.0";
    }

    /** Runs {@code c} on the main thread and waits for its result (directly when already there). */
    static <T> T onUi(Callable<T> c) throws Exception {
        return onUi(c, UI_TIMEOUT_MS);
    }

    /** Same as {@link #onUi(Callable)}, waiting at most {@code timeoutMs} for the main thread. */
    static <T> T onUi(Callable<T> c, long timeoutMs) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) return c.call();
        FutureTask<T> task = new FutureTask<>(c);
        MAIN.post(task);
        try {
            return task.get(Math.max(1, timeoutMs), TimeUnit.MILLISECONDS);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw e;
        } catch (TimeoutException e) {
            task.cancel(false);
            throw new HostException(HostException.FAILED, "Приложение не ответило вовремя, попробуй ещё раз");
        }
    }

    /**
     * True while GinN's window has input focus — Android 10+ lets an app read the clipboard only then.
     * Call on the UI thread.
     */
    boolean hasWindowFocus() {
        return !activity.isFinishing() && !activity.isDestroyed() && activity.hasWindowFocus();
    }

    /**
     * Starts the first intent that has a matching activity (on the UI thread). Returns it, or null if none could start.
     * Uses the Activity while it is alive (system screens then return to GinN on Back), otherwise the
     * application context with FLAG_ACTIVITY_NEW_TASK.
     */
    Intent startFirst(Intent... intents) throws Exception {
        return onUi(() -> {
            for (Intent intent : intents) {
                if (intent == null) continue;
                try {
                    if (activity.isFinishing() || activity.isDestroyed()) {
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        app.startActivity(intent);
                    } else {
                        activity.startActivity(intent);
                    }
                    return intent;
                } catch (ActivityNotFoundException | SecurityException e) {
                    // try the next fallback
                }
            }
            return null;
        });
    }

    // ---- PackageManager calls whose int-flag overloads are deprecated on API 33+ ----

    static List<ResolveInfo> queryActivities(PackageManager pm, Intent intent) {
        try {
            List<ResolveInfo> list = Build.VERSION.SDK_INT >= 33
                    ? Api33.queryActivities(pm, intent)
                    : legacyQueryActivities(pm, intent);
            return list != null ? list : Collections.<ResolveInfo>emptyList();
        } catch (RuntimeException e) {
            return Collections.emptyList();
        }
    }

    static ResolveInfo resolveActivity(PackageManager pm, Intent intent) {
        try {
            return Build.VERSION.SDK_INT >= 33 ? Api33.resolveActivity(pm, intent) : legacyResolveActivity(pm, intent);
        } catch (RuntimeException e) {
            return null;
        }
    }

    static PackageInfo packageInfo(PackageManager pm, String pkg) throws PackageManager.NameNotFoundException {
        return Build.VERSION.SDK_INT >= 33 ? Api33.packageInfo(pm, pkg) : legacyPackageInfo(pm, pkg);
    }

    static ApplicationInfo applicationInfo(PackageManager pm, String pkg) throws PackageManager.NameNotFoundException {
        return Build.VERSION.SDK_INT >= 33 ? Api33.applicationInfo(pm, pkg) : legacyApplicationInfo(pm, pkg);
    }

    @SuppressWarnings("deprecation")
    private static ApplicationInfo legacyApplicationInfo(PackageManager pm, String pkg)
            throws PackageManager.NameNotFoundException {
        return pm.getApplicationInfo(pkg, 0);
    }

    @SuppressWarnings("deprecation")
    private static List<ResolveInfo> legacyQueryActivities(PackageManager pm, Intent intent) {
        return pm.queryIntentActivities(intent, 0);
    }

    @SuppressWarnings("deprecation")
    private static ResolveInfo legacyResolveActivity(PackageManager pm, Intent intent) {
        return pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo legacyPackageInfo(PackageManager pm, String pkg) throws PackageManager.NameNotFoundException {
        return pm.getPackageInfo(pkg, 0);
    }

    @TargetApi(33)
    private static final class Api33 {
        static List<ResolveInfo> queryActivities(PackageManager pm, Intent intent) {
            return pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0));
        }

        static ResolveInfo resolveActivity(PackageManager pm, Intent intent) {
            return pm.resolveActivity(intent, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY));
        }

        static PackageInfo packageInfo(PackageManager pm, String pkg) throws PackageManager.NameNotFoundException {
            return pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0));
        }

        static ApplicationInfo applicationInfo(PackageManager pm, String pkg) throws PackageManager.NameNotFoundException {
            return pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0));
        }
    }
}
