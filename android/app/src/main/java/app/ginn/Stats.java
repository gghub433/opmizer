package app.ginn;

import android.app.ActivityManager;
import android.content.Context;
import android.os.PowerManager;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Live stats for Dashboard/Monitor (polled every ~1.5 s). Only real readings: when Android hides a value from
 * apps (CPU load since Android 8, GPU load) the field is null.
 */
final class Stats {
    private long prevTotal = -1;
    private long prevIdle = -1;
    private boolean procStatBlocked;
    private boolean freqBlocked;
    private int cores;

    synchronized JSONObject read(Host host) throws JSONException {
        Context ctx = host.app;
        JSONObject s = new JSONObject();

        Double load = cpuLoad();
        s.put("cpuLoad", load != null ? load : JSONObject.NULL);
        Long mhz = cpuMHz();
        s.put("cpuMHz", mhz != null ? mhz : JSONObject.NULL);

        ActivityManager.MemoryInfo mem = HardwareInfo.memory(ctx);
        long used = Math.max(0, mem.totalMem - mem.availMem);
        s.put("ramUsedPct", mem.totalMem > 0 ? Math.round(used * 100.0 / mem.totalMem) : 0);
        s.put("ramAvailMB", Fmt.mb(mem.availMem));

        HardwareInfo.Battery b = HardwareInfo.battery(ctx);
        boolean hasTemp = b != null && b.tempC != null;
        s.put("tempC", hasTemp ? b.tempC : JSONObject.NULL);
        s.put("tempSource", hasTemp ? "battery" : JSONObject.NULL);
        s.put("batteryLevel", b != null && b.level >= 0 ? b.level : JSONObject.NULL);

        String thermal = thermal(ctx);
        s.put("thermal", thermal != null ? thermal : JSONObject.NULL);
        s.put("gpuLoad", JSONObject.NULL);
        return s;
    }

    /** Total CPU load from /proc/stat deltas. Android 8+ blocks /proc/stat for apps, so this is usually null. */
    private Double cpuLoad() {
        if (procStatBlocked) return null;
        long[] now = parseProcStat(SysFs.firstLine("/proc/stat"));
        if (now == null) {
            procStatBlocked = true;
            return null;
        }
        if (prevTotal < 0) {
            // first call: take a short second sample so the very first answer already has a value
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
            prevTotal = now[0];
            prevIdle = now[1];
            now = parseProcStat(SysFs.firstLine("/proc/stat"));
            if (now == null) return null;
        }
        Double load = loadBetween(prevTotal, prevIdle, now[0], now[1]);
        prevTotal = now[0];
        prevIdle = now[1];
        return load;
    }

    /** "cpu  user nice system idle iowait irq softirq steal …" -> {total, idle+iowait}; null if unparsable. */
    static long[] parseProcStat(String line) {
        if (line == null || !line.startsWith("cpu ")) return null;
        String[] f = line.trim().split("\\s+");
        if (f.length < 5) return null;
        long total = 0;
        long idle = 0;
        try {
            int n = Math.min(f.length, 9); // user..steal; guest time is already counted in user
            for (int i = 1; i < n; i++) {
                long v = Long.parseLong(f[i]);
                total += v;
                if (i == 4 || i == 5) idle += v;
            }
        } catch (NumberFormatException e) {
            return null;
        }
        return total > 0 ? new long[] {total, idle} : null;
    }

    static Double loadBetween(long total0, long idle0, long total1, long idle1) {
        long dt = total1 - total0;
        long di = idle1 - idle0;
        if (dt <= 0 || di < 0) return null;
        double pct = 100.0 * (dt - di) / dt;
        return Fmt.round1(Math.max(0, Math.min(100, pct)));
    }

    /** Average current frequency of online cores, MHz. */
    private Long cpuMHz() {
        if (freqBlocked) return null;
        if (cores <= 0) cores = HardwareInfo.cpuCount();
        long sum = 0;
        int n = 0;
        for (int i = 0; i < cores; i++) {
            long khz = SysFs.readLong("/sys/devices/system/cpu/cpu" + i + "/cpufreq/scaling_cur_freq", -1);
            if (khz > 0) {
                sum += khz;
                n++;
            }
        }
        if (n == 0) {
            freqBlocked = true;
            return null;
        }
        return Math.round(sum / (double) n / 1000.0);
    }

    static String thermal(Context ctx) {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return thermalName(pm.getCurrentThermalStatus());
        } catch (RuntimeException e) {
            return null;
        }
    }

    static String thermalName(int status) {
        switch (status) {
            case PowerManager.THERMAL_STATUS_NONE:
                return "none";
            case PowerManager.THERMAL_STATUS_LIGHT:
                return "light";
            case PowerManager.THERMAL_STATUS_MODERATE:
                return "moderate";
            case PowerManager.THERMAL_STATUS_SEVERE:
                return "severe";
            case PowerManager.THERMAL_STATUS_CRITICAL:
                return "critical";
            case PowerManager.THERMAL_STATUS_EMERGENCY:
                return "emergency";
            case PowerManager.THERMAL_STATUS_SHUTDOWN:
                return "shutdown";
            default:
                return null;
        }
    }
}
