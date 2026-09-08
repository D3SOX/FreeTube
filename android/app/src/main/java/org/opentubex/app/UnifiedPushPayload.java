package org.opentubex.app;

import org.json.JSONObject;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/** Only plain notification text and a validated video ID may cross this boundary. */
final class UnifiedPushPayload {
    final String title;
    final String body;
    final String videoId;

    private UnifiedPushPayload(String title, String body, String videoId) {
        this.title = title;
        this.body = body;
        this.videoId = videoId;
    }

    static UnifiedPushPayload parse(byte[] content) throws Exception {
        if (content == null || content.length == 0 || content.length > 4096) {
            throw new IllegalArgumentException("Invalid push payload size");
        }
        String text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(content)).toString();
        JSONObject json = new JSONObject(text);
        if (!(json.opt("version") instanceof Number) || json.getDouble("version") != 1) {
            throw new IllegalArgumentException("Unsupported push payload version");
        }
        String title = string(json, "title", 160, false);
        String body = string(json, "body", 2000, true);
        String videoId = string(json, "videoId", 11, true);
        if (!videoId.isEmpty() && !videoId.matches("[A-Za-z0-9_-]{11}")) {
            throw new IllegalArgumentException("Invalid video ID");
        }
        return new UnifiedPushPayload(title, body, videoId);
    }

    private static String string(JSONObject json, String key, int maximum, boolean optional) {
        Object value = json.opt(key);
        if (value == null && optional) return "";
        if (!(value instanceof String)) throw new IllegalArgumentException("Invalid " + key);
        String text = ((String) value).trim();
        if ((!optional && text.isEmpty()) || text.length() > maximum) {
            throw new IllegalArgumentException("Invalid " + key);
        }
        return text;
    }
}
