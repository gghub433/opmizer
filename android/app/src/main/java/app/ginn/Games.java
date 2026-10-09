package app.ginn;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Installed games (launcher apps marked as games, or known from the UI catalog) and launching them. */
final class Games {
    private static final int ICON_PX = 96;

    private Games() {}

    static JSONArray list(Host host, JSONArray knownPackages) throws JSONException {
        Context ctx = host.app;
        PackageManager pm = ctx.getPackageManager();
        Set<String> known = new HashSet<>();
        if (knownPackages != null) {
            for (int i = 0; i < knownPackages.length(); i++) {
                String p = knownPackages.optString(i, null);
                if (p != null && !p.isEmpty()) known.add(p);
            }
        }
        String self = ctx.getPackageName();

        Map<String, ResolveInfo> byPackage = new LinkedHashMap<>();
        for (ResolveInfo ri : Booster.launcherActivities(pm)) {
            if (ri.activityInfo == null || ri.activityInfo.packageName == null) continue;
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(self) || byPackage.containsKey(pkg)) continue;
            byPackage.put(pkg, ri);
        }

        final Collator collator = Collator.getInstance(Fmt.RU);
        List<JSONObject> games = new ArrayList<>();
        for (Map.Entry<String, ResolveInfo> e : byPackage.entrySet()) {
            String pkg = e.getKey();
            ResolveInfo ri = e.getValue();
            if (!isGame(ri.activityInfo.applicationInfo) && !known.contains(pkg)) continue;
            JSONObject g = new JSONObject();
            g.put("id", pkg);
            g.put("name", label(pm, ri, pkg));
            g.put("catalogId", JSONObject.NULL);
            String icon = iconDataUrl(ri, pm);
            g.put("icon", icon != null ? icon : JSONObject.NULL);
            g.put("source", "android");
            games.add(g);
        }
        Collections.sort(games, (a, b) -> collator.compare(a.optString("name"), b.optString("name")));

        JSONArray out = new JSONArray();
        for (JSONObject g : games) out.put(g);
        return out;
    }

    @SuppressWarnings("deprecation")
    static boolean isGame(ApplicationInfo ai) {
        if (ai == null) return false;
        return ai.category == ApplicationInfo.CATEGORY_GAME || (ai.flags & ApplicationInfo.FLAG_IS_GAME) != 0;
    }

    private static String label(PackageManager pm, ResolveInfo ri, String fallback) {
        try {
            CharSequence l = ri.loadLabel(pm);
            if (l != null && l.toString().trim().length() > 0) return l.toString().trim();
        } catch (RuntimeException ignored) {
            // use the package name
        }
        return fallback;
    }

    private static String iconDataUrl(ResolveInfo ri, PackageManager pm) {
        Bitmap bmp = null;
        try {
            Drawable d = ri.loadIcon(pm);
            if (d == null) return null;
            bmp = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, ICON_PX, ICON_PX);
            d.draw(c);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!bmp.compress(Bitmap.CompressFormat.PNG, 100, out)) return null;
            return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (RuntimeException | OutOfMemoryError e) {
            return null;
        } finally {
            if (bmp != null) bmp.recycle();
        }
    }

    /** launchGame({id, boost}). */
    static JSONObject launch(Host host, String pkg, boolean boost) throws Exception {
        if (pkg == null || pkg.isEmpty()) throw new HostException(HostException.NOT_FOUND, "Игра не найдена");
        Context ctx = host.app;
        PackageManager pm = ctx.getPackageManager();
        Intent launch = pm.getLaunchIntentForPackage(pkg);
        if (launch == null) {
            throw new HostException(HostException.NOT_FOUND, "Игра не найдена — возможно, её удалили");
        }
        String name = appLabel(pm, pkg);

        boolean dnd = false;
        if (boost) {
            if (Booster.canKillOthers()) {
                Set<String> keep = new HashSet<>();
                keep.add(pkg);
                try {
                    Booster.killBackground(ctx, keep);
                } catch (HostException ignored) {
                    // boost is best effort: still launch the game
                }
            }
            dnd = Booster.enableDndForGame(host);
        }

        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        if (host.startFirst(launch) == null) {
            throw new HostException(HostException.FAILED, "Не получилось запустить «" + name + "»");
        }
        JSONObject out = new JSONObject();
        out.put("message", "Запускаю " + name + (dnd ? " — «Не беспокоить» включён" : ""));
        return out;
    }

    private static String appLabel(PackageManager pm, String pkg) {
        try {
            CharSequence l = pm.getApplicationLabel(Host.applicationInfo(pm, pkg));
            if (l != null && l.toString().trim().length() > 0) return l.toString().trim();
        } catch (PackageManager.NameNotFoundException | RuntimeException ignored) {
            // fall back to the package name
        }
        return pkg;
    }
}
