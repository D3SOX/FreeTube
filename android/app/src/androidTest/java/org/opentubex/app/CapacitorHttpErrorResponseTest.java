package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import com.getcapacitor.JSObject;
import com.getcapacitor.plugin.util.CapacitorHttpUrlConnection;
import com.getcapacitor.plugin.util.HttpRequestHandler;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class CapacitorHttpErrorResponseTest {
    @Test
    public void preservesEmptyHttpErrorsIncludingMissingShortsFeeds() throws Exception {
        for (int status : new int[] { 403, 404, 410, 429, 503 }) {
            HttpURLConnection raw = new HttpURLConnection(new URL("https://www.youtube.com/feeds/videos.xml")) {
                @Override public void connect() {}
                @Override public void disconnect() {}
                @Override public boolean usingProxy() { return false; }
                @Override public int getResponseCode() { return status; }
                @Override public Map<String, List<String>> getHeaderFields() { return Collections.emptyMap(); }
                @Override public InputStream getErrorStream() { return null; }
                @Override public InputStream getInputStream() throws FileNotFoundException {
                    throw new FileNotFoundException(url.toString());
                }
            };
            JSObject response = HttpRequestHandler.buildResponse(
                new CapacitorHttpUrlConnection(raw), HttpRequestHandler.ResponseType.TEXT);
            assertEquals(status, response.getInt("status"));
            assertEquals("", response.getString("data"));
        }
    }
}
