package app.ginn;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;

/** Best-effort readers for /proc and /sys. Many of these files are blocked by SELinux for normal apps: callers get null. */
final class SysFs {
    private SysFs() {}

    static String firstLine(String path) {
        try (BufferedReader r = new BufferedReader(new FileReader(path), 256)) {
            String line = r.readLine();
            return line == null ? null : line.trim();
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    /** Value of the first "key : value" line whose key equals {@code key}, or null. */
    static String keyValue(String path, String key) {
        try (BufferedReader r = new BufferedReader(new FileReader(path), 4096)) {
            String line;
            while ((line = r.readLine()) != null) {
                int colon = line.indexOf(':');
                if (colon <= 0) continue;
                if (line.substring(0, colon).trim().equals(key)) {
                    String v = line.substring(colon + 1).trim();
                    return v.isEmpty() ? null : v;
                }
            }
        } catch (IOException | RuntimeException e) {
            return null;
        }
        return null;
    }

    static long readLong(String path, long fallback) {
        String s = firstLine(path);
        if (s == null) return fallback;
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    static boolean exists(String path) {
        try {
            return new File(path).exists();
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Counts CPUs in a kernel cpu list such as "0-7" or "0-3,6,8-9". Returns 0 when it cannot parse it. */
    static int countCpuList(String spec) {
        if (spec == null) return 0;
        int count = 0;
        try {
            for (String part : spec.trim().split(",")) {
                String p = part.trim();
                if (p.isEmpty()) continue;
                int dash = p.indexOf('-');
                if (dash < 0) {
                    Integer.parseInt(p);
                    count++;
                } else {
                    int a = Integer.parseInt(p.substring(0, dash).trim());
                    int b = Integer.parseInt(p.substring(dash + 1).trim());
                    if (b < a) return 0;
                    count += b - a + 1;
                }
            }
        } catch (NumberFormatException e) {
            return 0;
        }
        return count;
    }
}
