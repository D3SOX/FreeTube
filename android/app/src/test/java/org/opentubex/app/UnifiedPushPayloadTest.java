package org.opentubex.app;

import org.junit.Test;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public class UnifiedPushPayloadTest {
    private static UnifiedPushPayload parse(String value) throws Exception {
        return UnifiedPushPayload.parse(value.getBytes(StandardCharsets.UTF_8));
    }

    @Test public void acceptsPlainTextAndOptionalVideoDestination() throws Exception {
        UnifiedPushPayload payload = parse("{\"version\":1,\"title\":\"New video\",\"body\":\"A & B\",\"videoId\":\"dQw4w9WgXcQ\"}");
        assertEquals("New video", payload.title);
        assertEquals("A & B", payload.body);
        assertEquals("dQw4w9WgXcQ", payload.videoId);
        assertEquals("", parse("{\"version\":1,\"title\":\"Hello\"}").videoId);
    }

    @Test public void rejectsMalformedOversizedOrUnsupportedMessages() {
        for (String value : new String[] {
            "{}", "not JSON", "{\"version\":2,\"title\":\"Hi\"}",
            "{\"version\":1,\"title\":42}", "{\"version\":1,\"title\":\" \"}",
            "{\"version\":1,\"title\":\"Hi\",\"videoId\":\"javascript:\"}",
            "{\"version\":1,\"title\":\"Hi\",\"videoId\":\"12345678901&url=x\"}",
            "{\"version\":1,\"title\":\"" + "x".repeat(161) + "\"}", "x".repeat(4097)
        }) {
            assertThrows(Exception.class, () -> parse(value));
        }
        assertThrows(Exception.class, () -> UnifiedPushPayload.parse(new byte[] {(byte) 0xc3, 0x28}));
    }

    @Test public void disabledAndSupersededRegistrationsRejectLateCallbacks() throws Exception {
        JSONObject state = new JSONObject().put("enabled", true).put("instance", "new-instance");
        assertTrue(UnifiedPushState.accepts(state, "new-instance"));
        assertFalse(UnifiedPushState.accepts(state, "old-instance"));
        assertFalse(UnifiedPushState.accepts(state, null));
        state.put("enabled", false);
        assertFalse(UnifiedPushState.accepts(state, "new-instance"));
        assertFalse(UnifiedPushState.accepts(new JSONObject(), ""));
    }
}
