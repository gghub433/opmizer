package app.ginn;

import android.content.ContentResolver;
import android.content.Context;
import android.os.PowerManager;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Android tweak list. Android does not let a normal app change system performance settings, so most items are
 * honest "links": GinN checks the real state and opens the right system screen. Only the RAM boost (Android 10-13)
 * and "Do not disturb" (with the user's permission) are changed by GinN itself.
 */
final class Tweaks {
    static final String BOOST_RAM = "boost_ram";
    static final String DND_GAMING = "dnd_gaming";
    static final String BATTERY_SAVER = "battery_saver";
    static final String REFRESH_RATE = "refresh_rate";
    static final String ANIMATIONS = "animations";
    static final String STORAGE_CLEANUP = "storage_cleanup";

    static final String[] IDS = {BOOST_RAM, DND_GAMING, BATTERY_SAVER, REFRESH_RATE, ANIMATIONS, STORAGE_CLEANUP};

    static final String OPENED = "Открыты настройки";

    private Tweaks() {}

    static JSONArray list(Host host) throws Exception {
        JSONArray out = new JSONArray();
        for (String id : IDS) out.put(describe(host, id));
        return out;
    }

    static JSONObject describe(Host host, String id) throws Exception {
        Context ctx = host.app;
        switch (id) {
            case BOOST_RAM: {
                boolean works = Booster.canKillOthers();
                return tweak(id, "system", "Ускорение — очистка ОЗУ",
                        works ? "Закрывает приложения, которые висят в фоне, и освобождает оперативную память перед игрой."
                              : Booster.BOOST_UNSUPPORTED + ".",
                        new String[] {"fps", "ram"}, "action", works ? "off" : "unknown", works);
            }
            case DND_GAMING: {
                boolean on = Booster.dndOn(ctx);
                String desc = "Включает «Не беспокоить»: уведомления не будут всплывать поверх игры. Не забудь выключить после.";
                if (!Booster.dndAccess(ctx)) desc += " Понадобится разрешение на доступ к «Не беспокоить».";
                return tweak(id, "system", "Не беспокоить во время игры", desc,
                        new String[] {"latency"}, "toggle", on ? "on" : "off", false);
            }
            case BATTERY_SAVER: {
                boolean saver = powerSaveMode(ctx);
                return tweak(id, "power", "Выключить экономию заряда",
                        saver ? "Сейчас включена экономия заряда: она снижает частоты процессора и FPS. Выключи её в настройках."
                              : "Экономия заряда выключена — процессор работает на полную.",
                        new String[] {"fps"}, "link", saver ? "off" : "on", true);
            }
            case REFRESH_RATE: {
                HardwareInfo.Screen s = HardwareInfo.screen(ctx);
                String state;
                String desc;
                if (s.maxRefreshHz <= 0) {
                    state = "unknown";
                    desc = "Не получилось узнать частоту экрана.";
                } else {
                    long cur = Math.round(s.refreshHz);
                    long max = Math.round(s.maxRefreshHz);
                    boolean atMax = s.refreshHz >= s.maxRefreshHz - 1;
                    state = atMax ? "on" : "off";
                    if (max <= 61) {
                        desc = "Экран работает на " + max + " Гц — это его максимум.";
                    } else if (atMax) {
                        desc = "Экран уже работает на максимальных " + max + " Гц.";
                    } else {
                        desc = "Сейчас " + cur + " Гц, а экран умеет до " + max
                                + " Гц. Выбери максимальную частоту в настройках экрана — игры станут плавнее.";
                    }
                }
                return tweak(id, "graphics", "Максимальная частота экрана", desc,
                        new String[] {"fps", "latency"}, "link", state, true);
            }
            case ANIMATIONS: {
                boolean fast = fastAnimations(ctx);
                String desc = fast
                        ? "Системные анимации уже ускорены — интерфейс отзывается быстрее."
                        : "Поставь «Анимация окон», «Анимация переходов» и «Длительность анимации» на 0,5x "
                                + "в параметрах разработчика — система станет отзывчивее.";
                return tweak(id, "system", "Быстрые анимации", desc,
                        new String[] {"latency"}, "link", fast ? "on" : "off", true);
            }
            case STORAGE_CLEANUP: {
                HardwareInfo.Storage st = HardwareInfo.storage();
                if (st.totalBytes <= 0) {
                    // StatFs failed: do not pretend to know ("0,0 ГБ из 0,0 ГБ — места хватает")
                    return tweak(id, "cleanup", "Очистка памяти",
                            "Не получилось узнать, сколько свободно места. Проверь это в настройках хранилища.",
                            new String[] {"storage"}, "link", "unknown", true);
                }
                boolean enough = storageOk(st);
                String free = Fmt.gb(st.freeBytes);
                String total = Fmt.gb(st.totalBytes);
                String desc = enough
                        ? "Свободно " + free + " ГБ из " + total + " ГБ — места хватает."
                        : "Свободно всего " + free + " ГБ из " + total
                                + " ГБ. Когда места меньше 15%, система и игры тормозят — освободи память.";
                return tweak(id, "cleanup", "Очистка памяти", desc,
                        new String[] {"storage"}, "link", enough ? "on" : "off", true);
            }
            default:
                throw new HostException(HostException.NOT_FOUND, "Такой настройки нет");
        }
    }

    private static JSONObject tweak(String id, String category, String title, String desc, String[] impact,
                                    String kind, String state, boolean recommended) throws JSONException {
        JSONObject t = new JSONObject();
        t.put("id", id);
        t.put("category", category);
        t.put("title", title);
        t.put("desc", desc);
        JSONArray imp = new JSONArray();
        for (String i : impact) imp.put(i);
        t.put("impact", imp);
        t.put("kind", kind);
        t.put("state", state);
        t.put("recommended", recommended);
        t.put("requiresAdmin", false);
        t.put("requiresReboot", false);
        t.put("risk", "safe");
        return t;
    }

    // ---------------------------------------------------------------- state checks

    static boolean powerSaveMode(Context ctx) {
        try {
            return ((PowerManager) ctx.getSystemService(Context.POWER_SERVICE)).isPowerSaveMode();
        } catch (RuntimeException e) {
            return false;
        }
    }

    static boolean fastAnimations(Context ctx) {
        ContentResolver cr = ctx.getContentResolver();
        return scale(cr, Settings.Global.ANIMATOR_DURATION_SCALE) <= 0.5f
                && scale(cr, Settings.Global.TRANSITION_ANIMATION_SCALE) <= 0.5f
                && scale(cr, Settings.Global.WINDOW_ANIMATION_SCALE) <= 0.5f;
    }

    private static float scale(ContentResolver cr, String key) {
        try {
            return Settings.Global.getFloat(cr, key, 1f);
        } catch (RuntimeException e) {
            return 1f;
        }
    }

    static boolean storageOk(HardwareInfo.Storage st) {
        if (st.totalBytes <= 0) return true; // unknown: do not nag
        return st.freeBytes * 100 >= st.totalBytes * 15;
    }

    // ---------------------------------------------------------------- applyTweak / revertAll

    static JSONObject apply(Host host, String id, boolean enable) throws Exception {
        if (id == null) throw new HostException(HostException.NOT_FOUND, "Такой настройки нет");
        String message;
        switch (id) {
            case BOOST_RAM:
                message = Booster.boostRam(host.app);
                return result(id, "on", message);
            case DND_GAMING:
                message = Booster.setDnd(host, enable);
                return result(id, Booster.dndOn(host.app) ? "on" : "off", message);
            case BATTERY_SAVER:
                message = openLink(host, "battery_saver");
                break;
            case REFRESH_RATE:
                message = openLink(host, "display");
                break;
            case ANIMATIONS:
                message = openLink(host, "developer");
                break;
            case STORAGE_CLEANUP:
                message = openLink(host, "storage");
                break;
            default:
                throw new HostException(HostException.NOT_FOUND, "Такой настройки нет");
        }
        return result(id, describe(host, id).optString("state", "unknown"), message);
    }

    private static String openLink(Host host, String target) throws Exception {
        String hint = Screens.openTarget(host, target);
        return hint != null ? hint : OPENED;
    }

    private static JSONObject result(String id, String state, String message) throws JSONException {
        JSONObject r = new JSONObject();
        r.put("id", id);
        r.put("state", state);
        r.put("message", message);
        r.put("needsReboot", false);
        return r;
    }

    /** Restores what GinN changed: today that is only "Do not disturb" (game profiles do not exist on Android). */
    static JSONObject revertAll(Host host) throws JSONException {
        JSONArray reverted = new JSONArray();
        JSONArray failed = new JSONArray();
        String dnd = Booster.revertDnd(host);
        if (dnd != null) {
            if (dnd.isEmpty()) {
                reverted.put(DND_GAMING);
            } else {
                JSONObject f = new JSONObject();
                f.put("id", DND_GAMING);
                f.put("error", dnd);
                failed.put(f);
            }
        }
        JSONObject out = new JSONObject();
        out.put("reverted", reverted);
        out.put("failed", failed);
        return out;
    }
}
