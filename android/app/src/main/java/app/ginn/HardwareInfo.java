package app.ginn;

import android.annotation.TargetApi;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.display.DisplayManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.view.Display;

import org.json.JSONException;
import org.json.JSONObject;

/** The "hardware" bridge method plus small snapshots (display, battery, memory, storage) shared with Stats/Tweaks. */
final class HardwareInfo {
    private HardwareInfo() {}

    static JSONObject read(Host host) throws Exception {
        Context ctx = host.app;
        JSONObject hw = new JSONObject();
        hw.put("device", device(ctx));
        hw.put("os", os());
        hw.put("cpu", cpu());

        JSONObject gpu = new JSONObject();
        gpu.put("name", JSONObject.NULL); // not exposed to apps without a GL context; the UI reads it from WebGL
        gpu.put("vramMB", JSONObject.NULL);
        hw.put("gpu", gpu);

        ActivityManager.MemoryInfo mem = memory(ctx);
        JSONObject ram = new JSONObject();
        ram.put("totalMB", Fmt.mb(mem.totalMem));
        ram.put("availMB", Fmt.mb(mem.availMem));
        hw.put("ram", ram);

        Storage st = storage();
        JSONObject storage = new JSONObject();
        storage.put("totalGB", Fmt.round1(st.totalBytes / Fmt.GIB));
        storage.put("freeGB", Fmt.round1(st.freeBytes / Fmt.GIB));
        String type = storageType();
        storage.put("type", type != null ? type : JSONObject.NULL);
        hw.put("storage", storage);

        Screen screen = screen(ctx);
        JSONObject display = new JSONObject();
        display.put("width", screen.width);
        display.put("height", screen.height);
        display.put("refreshHz", Math.round(screen.refreshHz));
        display.put("maxRefreshHz", Math.round(screen.maxRefreshHz));
        hw.put("display", display);

        Battery b = battery(ctx);
        if (b == null) {
            hw.put("battery", JSONObject.NULL);
        } else {
            JSONObject battery = new JSONObject();
            battery.put("present", true);
            battery.put("level", b.level >= 0 ? b.level : JSONObject.NULL);
            battery.put("charging", b.charging);
            battery.put("tempC", b.tempC != null ? b.tempC : JSONObject.NULL);
            hw.put("battery", battery);
        }
        return hw;
    }

    // ---------------------------------------------------------------- device / os / cpu

    private static JSONObject device(Context ctx) throws JSONException {
        String name = null;
        try {
            name = Fmt.clean(Settings.Global.getString(ctx.getContentResolver(), Settings.Global.DEVICE_NAME));
        } catch (RuntimeException ignored) {
            // some ROMs restrict it: use the model
        }
        if (name == null) name = Fmt.deviceName(Build.MANUFACTURER, Build.MODEL);

        JSONObject d = new JSONObject();
        d.put("name", name);
        d.put("manufacturer", Fmt.capitalize(Build.MANUFACTURER));
        d.put("model", Build.MODEL == null ? "" : Build.MODEL);
        int sw = ctx.getResources().getConfiguration().smallestScreenWidthDp;
        d.put("type", sw >= 600 ? "tablet" : "phone");
        return d;
    }

    private static JSONObject os() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("name", "Android " + Build.VERSION.RELEASE);
        o.put("version", Build.VERSION.RELEASE);
        o.put("build", Build.DISPLAY);
        o.put("sdk", Build.VERSION.SDK_INT);
        return o;
    }

    private static JSONObject cpu() throws JSONException {
        String name = null;
        String vendor = null;
        if (Build.VERSION.SDK_INT >= 31) {
            name = Fmt.clean(Api31.socModel());
            vendor = Fmt.clean(Api31.socManufacturer());
        }
        if (name == null) name = Fmt.clean(SysFs.keyValue("/proc/cpuinfo", "Hardware"));
        if (name == null) name = Fmt.clean(Build.HARDWARE);

        int cores = cpuCount();
        long maxKHz = 0;
        for (int i = 0; i < cores; i++) {
            maxKHz = Math.max(maxKHz, SysFs.readLong("/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq", 0));
        }

        JSONObject c = new JSONObject();
        c.put("name", name != null ? name : JSONObject.NULL);
        c.put("vendor", vendor != null ? vendor : JSONObject.NULL);
        c.put("cores", cores);
        c.put("threads", cores);
        c.put("maxMHz", maxKHz > 0 ? Math.round(maxKHz / 1000.0) : JSONObject.NULL);
        String[] abis = Build.SUPPORTED_ABIS;
        c.put("arch", abis != null && abis.length > 0 ? abis[0] : System.getProperty("os.arch", "unknown"));
        return c;
    }

    /** Physical core count: big cores may be offline, so availableProcessors() alone can be too low. */
    static int cpuCount() {
        int present = SysFs.countCpuList(SysFs.firstLine("/sys/devices/system/cpu/present"));
        return Math.max(Runtime.getRuntime().availableProcessors(), present);
    }

    // ---------------------------------------------------------------- memory / storage

    static ActivityManager.MemoryInfo memory(Context ctx) {
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        return mi;
    }

    static final class Storage {
        long totalBytes;
        long freeBytes;
    }

    static Storage storage() {
        Storage s = new Storage();
        try {
            StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
            s.totalBytes = fs.getTotalBytes();
            s.freeBytes = fs.getAvailableBytes();
        } catch (RuntimeException ignored) {
            // leave zeros
        }
        return s;
    }

    /** "UFS" when the SCSI block device of UFS storage is visible; null when it cannot be told (eMMC, blocked sysfs). */
    static String storageType() {
        if (SysFs.exists("/sys/block/sda") || SysFs.exists("/dev/block/sda")) return "UFS";
        return null;
    }

    // ---------------------------------------------------------------- display

    static final class Screen {
        int width;
        int height;
        float refreshHz;
        float maxRefreshHz;
    }

    /** Current mode of the built-in display, read on the UI thread. */
    static Screen screen(Context ctx) throws Exception {
        return Host.onUi(() -> {
            Screen s = new Screen();
            DisplayManager dm = (DisplayManager) ctx.getSystemService(Context.DISPLAY_SERVICE);
            Display d = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
            if (d == null) return s;
            Display.Mode mode = d.getMode();
            s.width = mode.getPhysicalWidth();
            s.height = mode.getPhysicalHeight();
            s.refreshHz = d.getRefreshRate();
            float max = s.refreshHz;
            Display.Mode[] modes = d.getSupportedModes();
            if (modes != null) {
                for (Display.Mode m : modes) max = Math.max(max, m.getRefreshRate());
            }
            s.maxRefreshHz = max;
            return s;
        });
    }

    // ---------------------------------------------------------------- battery

    static final class Battery {
        int level = -1;
        boolean charging;
        Double tempC;
    }

    /** Sticky ACTION_BATTERY_CHANGED snapshot; null when the device has no battery. */
    static Battery battery(Context ctx) {
        Intent i;
        try {
            i = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        } catch (RuntimeException e) {
            return null;
        }
        if (i == null || !i.getBooleanExtra(BatteryManager.EXTRA_PRESENT, true)) return null;
        Battery b = new Battery();
        int level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        if (level >= 0 && scale > 0) b.level = Math.round(level * 100f / scale);
        int status = i.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN);
        int plugged = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
        b.charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                || (status == BatteryManager.BATTERY_STATUS_FULL && plugged != 0);
        int tenths = i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
        if (tenths != Integer.MIN_VALUE && tenths > -400 && tenths < 1500) b.tempC = tenths / 10.0;
        return b;
    }

    @TargetApi(31)
    private static final class Api31 {
        static String socModel() {
            return Build.SOC_MODEL;
        }

        static String socManufacturer() {
            return Build.SOC_MANUFACTURER;
        }
    }
}
