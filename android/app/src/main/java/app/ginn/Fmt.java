package app.ginn;

import java.util.Locale;

/** Number/text formatting helpers. Pure Java, no Android state. */
final class Fmt {
    static final Locale RU = Locale.forLanguageTag("ru-RU");
    static final double MIB = 1024.0 * 1024.0;
    static final double GIB = MIB * 1024.0;

    private Fmt() {}

    /** Bytes -> "3,4" (GiB, one decimal, Russian decimal comma). */
    static String gb(long bytes) {
        return String.format(RU, "%.1f", bytes / GIB);
    }

    /** Bytes -> whole MiB. */
    static long mb(long bytes) {
        return Math.round(bytes / MIB);
    }

    static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    /** "samsung" -> "Samsung"; null/blank -> "". */
    static String capitalize(String s) {
        if (s == null) return "";
        String t = s.trim();
        if (t.isEmpty()) return "";
        return Character.toUpperCase(t.charAt(0)) + t.substring(1);
    }

    /** null, blank and "unknown" (any case) -> null; otherwise trimmed. */
    static String clean(String s) {
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty() || t.equalsIgnoreCase("unknown")) return null;
        return t;
    }

    /** "Samsung" + "SM-A556B" -> "Samsung SM-A556B"; "Google" + "Google Pixel 8" -> "Google Pixel 8". */
    static String deviceName(String manufacturer, String model) {
        String man = capitalize(manufacturer);
        String mod = model == null ? "" : model.trim();
        if (mod.isEmpty()) return man.isEmpty() ? "Android" : man;
        if (man.isEmpty() || mod.toLowerCase(Locale.ROOT).startsWith(man.toLowerCase(Locale.ROOT))) {
            return capitalize(mod);
        }
        return man + " " + mod;
    }
}
