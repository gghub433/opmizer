package app.ginn;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves the web UI from APK assets at https://appassets.androidplatform.net/assets/… (same scheme as androidx
 * WebViewAssetLoader, without the dependency). The assets root is the repo's ui/ folder, so index.html is at the top.
 */
final class AssetServer {
    static final String HOST = "appassets.androidplatform.net";
    static final String PATH_PREFIX = "/assets/";
    static final String BASE_URL = "https://" + HOST + PATH_PREFIX;
    static final String INDEX_URL = BASE_URL + "index.html";
    /** Fallback only (see MainActivity.onReceivedError). */
    static final String FILE_INDEX_URL = "file:///android_asset/index.html";

    private final AssetManager assets;

    AssetServer(AssetManager assets) {
        this.assets = assets;
    }

    /** True for URLs that belong to the bundled UI. */
    static boolean isAppUrl(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost());
    }

    /** file:///android_asset/… (the fallback copy of the UI). */
    static boolean isAssetFileUrl(Uri uri) {
        if (uri == null || !"file".equalsIgnoreCase(uri.getScheme())) return false;
        String path = uri.getPath();
        return path != null && path.startsWith("/android_asset/") && !path.contains("..");
    }

    /** Answers every request for our origin: the asset, or a 404. Never returns null for app URLs. */
    WebResourceResponse serve(Uri uri) {
        String path = assetPath(uri.getPath());
        if (path == null) return notFound();
        InputStream in;
        try {
            in = assets.open(path, AssetManager.ACCESS_STREAMING);
        } catch (IOException | RuntimeException e) {
            return notFound();
        }
        String mime = mimeType(path);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse(mime, isText(mime) ? "UTF-8" : null, 200, "OK", headers, in);
    }

    private static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers,
                new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));
    }

    /**
     * URL path -> asset path: "/assets/js/app.js" -> "js/app.js", "/assets/" -> "index.html".
     * Returns null for anything outside /assets/ or with empty, "." or ".." segments.
     */
    static String assetPath(String urlPath) {
        if (urlPath == null || !urlPath.startsWith(PATH_PREFIX)) return null;
        String rel = urlPath.substring(PATH_PREFIX.length());
        if (rel.isEmpty() || rel.endsWith("/")) rel = rel + "index.html";
        if (rel.indexOf('\\') >= 0 || rel.indexOf('\0') >= 0) return null;
        for (String segment : rel.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return null;
        }
        return rel;
    }

    static String mimeType(String path) {
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        String ext = dot > slash ? path.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        switch (ext) {
            case "html":
            case "htm":
                return "text/html";
            case "js":
            case "mjs":
                return "text/javascript";
            case "css":
                return "text/css";
            case "svg":
                return "image/svg+xml";
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "webp":
                return "image/webp";
            case "gif":
                return "image/gif";
            case "ico":
                return "image/x-icon";
            case "json":
            case "map":
                return "application/json";
            case "woff2":
                return "font/woff2";
            case "woff":
                return "font/woff";
            case "txt":
                return "text/plain";
            case "wasm":
                return "application/wasm";
            default:
                return "application/octet-stream";
        }
    }

    static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml");
    }
}
