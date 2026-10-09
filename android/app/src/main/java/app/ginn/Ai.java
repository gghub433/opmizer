package app.ginn;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.regex.Pattern;

/**
 * GinN AI on Android (transport 'page'). The request to Claude is made inside the WebView by the bundled official
 * JS SDK (ui/js/vendor/anthropic-sdk.js), so the native side only keeps the user's API key and model choice in
 * private SharedPreferences "ginn_ai" (MODE_PRIVATE, excluded from backups and device transfer).
 *
 *   aiStatus()                  -> {configured, model, transport:'page'}
 *   aiConfigure({key?, model?}) -> status       key is trimmed; bad key/model -> BAD_ARGS, nothing is written
 *   aiClear()                   -> status       forgets the key, keeps the model choice
 *   aiKey()                     -> {key}        or AI_NO_KEY
 *   aiMessage()                 -> UNSUPPORTED  (desktop only: there Electron main calls Claude)
 *
 * The key is never logged and never part of an error message.
 */
final class Ai {
    static final String PREFS = "ginn_ai";
    static final String PREF_KEY = "api_key";
    static final String PREF_MODEL = "model";

    static final String TRANSPORT = "page";
    static final String DEFAULT_MODEL = "claude-opus-5-5";
    static final String[] MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"};

    static final String MSG_NO_KEY = "Добавь ключ Claude API, чтобы включить ИИ";
    static final String MSG_KEY_EMPTY = "Вставь ключ API — поле пустое";
    static final String MSG_KEY_BAD = "Ключ выглядит неправильно. Скопируй его целиком из консоли Anthropic";
    static final String MSG_MODEL_BAD = "Такой модели нет. Выбери Opus, Sonnet или Haiku";
    static final String MSG_SAVE_FAILED = "Не получилось сохранить настройки ИИ. Попробуй ещё раз";
    static final String MSG_CLEAR_FAILED = "Не получилось удалить ключ. Попробуй ещё раз";
    static final String MSG_PAGE_ONLY = "На Android запрос к Claude отправляет сам интерфейс GinN, а не приложение";
    static final String MSG_FOREIGN_PAGE = "Ключ выдаётся только интерфейсу GinN";

    /** Same rule as the desktop host: printable ASCII without spaces, 20–512 chars (sk-ant-…). */
    private static final Pattern KEY_SHAPE = Pattern.compile("[\\x21-\\x7e]{20,512}");

    /** Serializes read-modify-write of the prefs (the bridge runs calls on several threads). */
    private static final Object LOCK = new Object();

    private Ai() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- bridge methods

    static JSONObject status(SharedPreferences p) throws JSONException {
        synchronized (LOCK) {
            JSONObject o = new JSONObject();
            o.put("configured", storedKey(p) != null);
            o.put("model", storedModel(p));
            o.put("transport", TRANSPORT);
            return o;
        }
    }

    /** aiConfigure({key?, model?}). Both values are checked before anything is written. */
    static JSONObject configure(SharedPreferences p, JSONObject args) throws HostException, JSONException {
        String key = normalizeKey(args == null ? null : args.opt("key"));
        String model = normalizeModel(args == null ? null : args.opt("model"));
        synchronized (LOCK) {
            if (key != null || model != null) {
                SharedPreferences.Editor e = p.edit();
                if (key != null) e.putString(PREF_KEY, key);
                if (model != null) e.putString(PREF_MODEL, model);
                // commit (not apply): we are on a bridge thread and must know the key really reached the disk
                if (!e.commit()) throw new HostException(HostException.FAILED, MSG_SAVE_FAILED);
            }
            return status(p);
        }
    }

    /** aiClear(): forgets the key; the chosen model stays. */
    static JSONObject clear(SharedPreferences p) throws HostException, JSONException {
        synchronized (LOCK) {
            if (p.contains(PREF_KEY) && !p.edit().remove(PREF_KEY).commit()) {
                throw new HostException(HostException.FAILED, MSG_CLEAR_FAILED);
            }
            return status(p);
        }
    }

    /** aiKey() -> {key} for the in-page SDK, or AI_NO_KEY. */
    static JSONObject key(SharedPreferences p) throws HostException, JSONException {
        String key;
        synchronized (LOCK) {
            key = storedKey(p);
        }
        if (key == null) throw new HostException(HostException.AI_NO_KEY, MSG_NO_KEY);
        JSONObject o = new JSONObject();
        o.put("key", key);
        return o;
    }

    // ---------------------------------------------------------------- validation (pure)

    /**
     * The "key" argument: null when absent (missing / JSON null), otherwise the trimmed key.
     * Non-string, empty or oddly shaped keys -> BAD_ARGS (the message never contains the key).
     */
    static String normalizeKey(Object raw) throws HostException {
        if (raw == null || raw == JSONObject.NULL) return null;
        if (!(raw instanceof String)) throw new HostException(HostException.BAD_ARGS, MSG_KEY_BAD);
        String key = ((String) raw).trim();
        if (key.isEmpty()) throw new HostException(HostException.BAD_ARGS, MSG_KEY_EMPTY);
        if (!keyLooksValid(key)) throw new HostException(HostException.BAD_ARGS, MSG_KEY_BAD);
        return key;
    }

    /** The "model" argument: null when absent, otherwise one of {@link #MODELS}; anything else -> BAD_ARGS. */
    static String normalizeModel(Object raw) throws HostException {
        if (raw == null || raw == JSONObject.NULL) return null;
        if (raw instanceof String && isModel((String) raw)) return (String) raw;
        throw new HostException(HostException.BAD_ARGS, MSG_MODEL_BAD);
    }

    static boolean keyLooksValid(String key) {
        return key != null && KEY_SHAPE.matcher(key).matches();
    }

    static boolean isModel(String id) {
        if (id == null) return false;
        for (String m : MODELS) {
            if (m.equals(id)) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- storage

    /** The stored key, or null when there is none (or the stored value is unusable). */
    private static String storedKey(SharedPreferences p) {
        String k;
        try {
            k = p.getString(PREF_KEY, null);
        } catch (ClassCastException e) {
            return null; // not a string: treat as "no key"
        }
        return keyLooksValid(k) ? k : null;
    }

    private static String storedModel(SharedPreferences p) {
        String m;
        try {
            m = p.getString(PREF_MODEL, null);
        } catch (ClassCastException e) {
            m = null;
        }
        return isModel(m) ? m : DEFAULT_MODEL;
    }
}
