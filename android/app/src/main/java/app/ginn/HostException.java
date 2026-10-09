package app.ginn;

/** A failure that goes back to the UI as {"ok":false,"code":…,"error":…}. The message is shown to the user (Russian). */
final class HostException extends Exception {
    private static final long serialVersionUID = 1L;

    static final String NEEDS_PERMISSION = "NEEDS_PERMISSION";
    static final String UNSUPPORTED = "UNSUPPORTED";
    static final String NOT_FOUND = "NOT_FOUND";
    static final String FAILED = "FAILED";
    /** Arguments the method cannot accept (wrong model id, empty key, …). */
    static final String BAD_ARGS = "BAD_ARGS";
    /** GinN AI: no Claude API key stored on this device. */
    static final String AI_NO_KEY = "AI_NO_KEY";

    final String code;

    HostException(String code, String message) {
        super(message);
        this.code = code;
    }
}
