package app.ginn;

import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** RAM boost (closing background apps) and "Do not disturb" control. */
final class Booster {
    private static final String PREF_DND_BY_GINN = "dnd_by_ginn";

    private Booster() {}

    // ---------------------------------------------------------------- launchable apps

    /** All MAIN/LAUNCHER activities visible to us (manifest <queries>). */
    static List<ResolveInfo> launcherActivities(PackageManager pm) {
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        return Host.queryActivities(pm, main);
    }

    static Set<String> launchablePackages(Context ctx) {
        Set<String> out = new LinkedHashSet<>();
        for (ResolveInfo ri : launcherActivities(ctx.getPackageManager())) {
            if (ri.activityInfo != null && ri.activityInfo.packageName != null) out.add(ri.activityInfo.packageName);
        }
        return out;
    }

    // ---------------------------------------------------------------- RAM boost

    /**
     * Android 14+ only lets third-party apps kill their OWN background processes
     * (ActivityManager.killBackgroundProcesses), so the boost really works on Android 10-13 only.
     */
    static boolean canKillOthers() {
        return Build.VERSION.SDK_INT < 34;
    }

    static final String BOOST_UNSUPPORTED =
            "На Android 14 и новее система не даёт закрывать чужие приложения — фон она выгружает сама, когда игре нужна память";

    /** Asks the system to kill background processes of every launchable app except {@code keep} and the launcher. */
    static int killBackground(Context ctx, Set<String> keep) throws HostException {
        if (!canKillOthers()) return 0;
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        Set<String> skip = new HashSet<>(keep);
        skip.add(ctx.getPackageName());
        ResolveInfo home = Host.resolveActivity(ctx.getPackageManager(),
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        if (home != null && home.activityInfo != null) skip.add(home.activityInfo.packageName);

        int asked = 0;
        for (String pkg : launchablePackages(ctx)) {
            if (skip.contains(pkg)) continue;
            try {
                am.killBackgroundProcesses(pkg);
                asked++;
            } catch (SecurityException e) {
                throw new HostException(HostException.NEEDS_PERMISSION, "Android не дал GinN закрывать фоновые приложения");
            } catch (RuntimeException ignored) {
                // one odd package must not stop the rest
            }
        }
        return asked;
    }

    /** The "boost_ram" action: kill background apps and report the real change in available RAM. */
    static String boostRam(Context ctx) throws HostException {
        if (!canKillOthers()) throw new HostException(HostException.UNSUPPORTED, BOOST_UNSUPPORTED);
        long before = HardwareInfo.memory(ctx).availMem;
        killBackground(ctx, new HashSet<String>());
        try {
            Thread.sleep(600); // give the system a moment to reclaim the memory
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        long after = HardwareInfo.memory(ctx).availMem;
        return boostMessage(before, after);
    }

    static String boostMessage(long beforeBytes, long afterBytes) {
        long freedMB = Fmt.mb(afterBytes - beforeBytes);
        String free = "Свободно " + Fmt.gb(afterBytes) + " ГБ ОЗУ";
        if (freedMB >= 1) return free + " (+" + freedMB + " МБ)";
        return free + " — фон уже был почти пустой";
    }

    // ---------------------------------------------------------------- Do not disturb

    private static NotificationManager nm(Context ctx) {
        return (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    static boolean dndAccess(Context ctx) {
        try {
            return nm(ctx).isNotificationPolicyAccessGranted();
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** True when any DND mode is active (priority only, alarms only or total silence). */
    static boolean dndOn(Context ctx) {
        try {
            return nm(ctx).getCurrentInterruptionFilter() > NotificationManager.INTERRUPTION_FILTER_ALL;
        } catch (RuntimeException e) {
            return false;
        }
    }

    static final String DND_NEEDS_ACCESS = "Разреши GinN доступ к режиму «Не беспокоить» в настройках";

    /** The "dnd_gaming" toggle. Returns a short result message. */
    static String setDnd(Host host, boolean enable) throws HostException {
        Context ctx = host.app;
        if (!dndAccess(ctx)) throw new HostException(HostException.NEEDS_PERMISSION, DND_NEEDS_ACCESS);
        SharedPreferences prefs = host.prefs();
        if (enable) {
            if (dndOn(ctx)) return "«Не беспокоить» уже включён";
            nm(ctx).setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
            prefs.edit().putBoolean(PREF_DND_BY_GINN, true).apply();
            return "«Не беспокоить» включён";
        }
        nm(ctx).setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
        prefs.edit().putBoolean(PREF_DND_BY_GINN, false).apply();
        return "«Не беспокоить» выключен";
    }

    /** For game launch with boost: turns DND on when we have access and it is off. True if GinN switched it on now. */
    static boolean enableDndForGame(Host host) {
        Context ctx = host.app;
        if (!dndAccess(ctx) || dndOn(ctx)) return false;
        try {
            nm(ctx).setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
        } catch (RuntimeException e) {
            return false;
        }
        host.prefs().edit().putBoolean(PREF_DND_BY_GINN, true).apply();
        return true;
    }

    /**
     * Undo DND only if GinN switched it on. Returns null when there was nothing to revert, "" when reverted,
     * or an error message.
     */
    static String revertDnd(Host host) {
        SharedPreferences prefs = host.prefs();
        if (!prefs.getBoolean(PREF_DND_BY_GINN, false)) return null;
        Context ctx = host.app;
        if (!dndOn(ctx)) {
            prefs.edit().putBoolean(PREF_DND_BY_GINN, false).apply();
            return null; // the user already turned it off
        }
        if (!dndAccess(ctx)) return "Нет доступа к «Не беспокоить» — выключи режим вручную";
        try {
            nm(ctx).setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
        } catch (RuntimeException e) {
            return "Не получилось выключить «Не беспокоить»";
        }
        prefs.edit().putBoolean(PREF_DND_BY_GINN, false).apply();
        return "";
    }
}
