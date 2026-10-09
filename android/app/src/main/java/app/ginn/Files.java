package app.ginn;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import org.json.JSONObject;

import java.io.OutputStream;
import java.util.Locale;

/** saveFile: writes into the public Downloads folder through MediaStore (no storage permission needed on 10+). */
final class Files {
    private static final String OCTET = "application/octet-stream";

    private Files() {}

    static JSONObject save(Host host, String name, String base64, String mime, boolean open) throws Exception {
        String fileName = safeName(name);
        byte[] data = decode(base64);
        String viewMime = mime == null || mime.trim().isEmpty() ? guessMime(fileName) : mime.trim();

        Context ctx = host.app;
        ContentResolver cr = ctx.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        // MediaStore renames files whose extension does not match the MIME type ("pack.mcpack" -> "pack.mcpack.zip"),
        // so the stored type always follows the extension; unknown extensions are stored as octet-stream.
        v.put(MediaStore.MediaColumns.MIME_TYPE, guessMime(fileName));
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri;
        try {
            uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        } catch (RuntimeException e) {
            uri = null;
        }
        if (uri == null) throw new HostException(HostException.FAILED, "Не получилось сохранить файл в «Загрузки»");

        try (OutputStream os = cr.openOutputStream(uri, "w")) {
            if (os == null) throw new java.io.IOException("no stream");
            os.write(data);
        } catch (Exception e) {
            discard(cr, uri);
            throw new HostException(HostException.FAILED, "Не получилось записать файл — проверь, хватает ли места");
        }
        // Publish the file. If this fails it would stay hidden (pending) in Downloads, so remove it and say so.
        boolean published;
        try {
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            published = cr.update(uri, done, null, null) > 0;
        } catch (RuntimeException e) {
            published = false;
        }
        if (!published) {
            discard(cr, uri);
            throw new HostException(HostException.FAILED, "Не получилось сохранить файл в «Загрузки»");
        }

        String stored = displayName(cr, uri, fileName);
        JSONObject out = new JSONObject();
        out.put("path", Environment.DIRECTORY_DOWNLOADS + "/" + stored);

        if (open) {
            // Started directly, without asking PackageManager first: GinN can only *see* launcher apps (package
            // visibility), but the system still resolves the implicit intent against every installed app and shows
            // its own picker. ActivityNotFoundException (-> null) means nothing on the phone can open the file.
            Intent view = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, viewMime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            if (host.startFirst(view) == null) {
                out.put("message", "Файл «" + stored + "» сохранён в «Загрузки». Открыть его нечем — найди его в приложении «Файлы».");
            } else {
                out.put("message", "Файл «" + stored + "» сохранён в «Загрузки»");
            }
        } else {
            out.put("message", "Файл «" + stored + "» сохранён в «Загрузки»");
        }
        return out;
    }

    /** Strips folders and characters that are not allowed in file names. Never returns an empty name. */
    static String safeName(String name) {
        String n = name == null ? "" : name.trim();
        int slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (slash >= 0) n = n.substring(slash + 1);
        StringBuilder sb = new StringBuilder(n.length());
        for (int i = 0; i < n.length(); i++) {
            char c = n.charAt(i);
            if (c < 0x20 || c == 0x7f || "<>:\"|?*".indexOf(c) >= 0) continue;
            sb.append(c);
        }
        n = sb.toString().trim();
        while (n.startsWith(".")) n = n.substring(1);
        // trailing dots/spaces are dropped by FAT-style storage and confuse MediaStore's extension handling
        while (n.endsWith(".") || n.endsWith(" ")) n = n.substring(0, n.length() - 1);
        if (n.isEmpty()) n = "ginn-file";
        if (n.length() > 120) {
            int dot = n.lastIndexOf('.');
            String ext = dot > 0 && n.length() - dot <= 12 ? n.substring(dot) : "";
            n = n.substring(0, 120 - ext.length()) + ext;
        }
        return n;
    }

    /** Accepts plain base64 or a data: URL. */
    static byte[] decode(String base64) throws HostException {
        if (base64 == null) throw new HostException(HostException.FAILED, "Нет данных для сохранения");
        String b = base64;
        if (b.startsWith("data:")) {
            int comma = b.indexOf(',');
            b = comma >= 0 ? b.substring(comma + 1) : "";
        }
        try {
            return Base64.decode(b, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            throw new HostException(HostException.FAILED, "Файл повреждён: не получилось прочитать данные");
        }
    }

    static String guessMime(String fileName) {
        int dot = fileName.lastIndexOf('.');
        if (dot < 0 || dot == fileName.length() - 1) return OCTET;
        String ext = fileName.substring(dot + 1).toLowerCase(Locale.ROOT);
        String mime = null;
        try {
            mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        } catch (RuntimeException ignored) {
            // treat as unknown
        }
        return mime != null ? mime : OCTET;
    }

    private static void discard(ContentResolver cr, Uri uri) {
        try {
            cr.delete(uri, null, null);
        } catch (RuntimeException ignored) {
            // a pending item is removed by the system after a week anyway
        }
    }

    private static String displayName(ContentResolver cr, Uri uri, String fallback) {
        try (Cursor c = cr.query(uri, new String[] {MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.isEmpty()) return n;
            }
        } catch (RuntimeException ignored) {
            // keep the requested name
        }
        return fallback;
    }
}
