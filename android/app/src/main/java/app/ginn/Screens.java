package app.ginn;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.storage.StorageManager;
import android.provider.Settings;

import org.json.JSONObject;

import java.util.Locale;
import java.util.regex.Pattern;

/** Opening system settings screens and external links. Every screen has fallbacks for OEM ROMs that lack it. */
final class Screens {
    static final String DEV_HINT = "Нажми 7 раз на «Номер сборки», чтобы включить режим разработчика";
    private static final Pattern PACKAGE = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+");

    private Screens() {}

    /** openSettings({target}). Returns {} or {message} with a hint for the user. */
    static JSONObject open(Host host, String target) throws Exception {
        JSONObject out = new JSONObject();
        String hint = openTarget(host, target);
        if (hint != null) out.put("message", hint);
        return out;
    }

    /** Opens the screen; returns an optional hint message. */
    static String openTarget(Host host, String target) throws Exception {
        if (target == null) target = "";
        switch (target) {
            case "developer":
                return openDeveloper(host);
            case "battery_saver":
                start(host, new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS),
                        new Intent(Intent.ACTION_POWER_USAGE_SUMMARY), general());
                return null;
            case "display":
                start(host, new Intent(Settings.ACTION_DISPLAY_SETTINGS), general());
                return null;
            case "dnd_access":
                start(host, new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS),
                        new Intent(Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS), general());
                return null;
            case "storage":
                start(host, new Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS),
                        new Intent(StorageManager.ACTION_MANAGE_STORAGE), general());
                return null;
            default:
                if (target.startsWith("app_details:")) {
                    String pkg = target.substring("app_details:".length());
                    if (!PACKAGE.matcher(pkg).matches()) {
                        throw new HostException(HostException.NOT_FOUND, "Не знаю такое приложение");
                    }
                    start(host, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.fromParts("package", pkg, null)));
                    return null;
                }
                throw new HostException(HostException.UNSUPPORTED, "Такого раздела настроек на Android нет");
        }
    }

    static boolean developerOptionsEnabled(Context ctx) {
        try {
            return Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) != 0;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Developer options, or "About phone" plus a hint when they are still hidden. */
    static String openDeveloper(Host host) throws Exception {
        if (developerOptionsEnabled(host.app)) {
            start(host, new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS), general());
            return null;
        }
        start(host, new Intent(Settings.ACTION_DEVICE_INFO_SETTINGS), general());
        return DEV_HINT;
    }

    private static Intent general() {
        return new Intent(Settings.ACTION_SETTINGS);
    }

    private static void start(Host host, Intent... intents) throws Exception {
        if (host.startFirst(intents) == null) {
            throw new HostException(HostException.NOT_FOUND, "Не получилось открыть настройки на этом устройстве");
        }
    }

    // ---------------------------------------------------------------- external links

    /** ACTION_VIEW intent for a link we are willing to hand to other apps, or null (file:, content:, javascript: …). */
    static Intent externalIntent(String url) {
        if (url == null) return null;
        Uri uri = Uri.parse(url.trim());
        String scheme = uri.getScheme();
        if (scheme == null) return null;
        switch (scheme.toLowerCase(Locale.ROOT)) {
            case "http":
            case "https":
            case "mailto":
            case "tel":
            case "market":
            case "tg":
                return new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
            default:
                return null;
        }
    }

    static JSONObject openExternal(Host host, String url) throws Exception {
        Intent intent = externalIntent(url);
        if (intent == null) throw new HostException(HostException.UNSUPPORTED, "Такую ссылку открыть нельзя");
        if (host.startFirst(intent) == null) {
            throw new HostException(HostException.NOT_FOUND, "Нет приложения, чтобы открыть ссылку");
        }
        return new JSONObject();
    }
}
