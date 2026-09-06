package org.opentubex.app;

import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.*;

public class YtDlpSubtitleTest {
    private static final String URL = "https://www.youtube.com/api/timedtext?v=eeeeeeeeeee&lang=en&tlang=de&fmt=vtt&pot=test-token";

    @Test public void acceptsOnlyTheYouTubeSubtitleEndpointAndSupportedFormats() {
        assertEquals("vtt", YtDlpSubtitle.format(URL));
        assertEquals("srt", YtDlpSubtitle.format(URL.replace("fmt=vtt", "fmt=srt")));
        assertEquals("vtt", YtDlpSubtitle.format(URL.replace("www.youtube.com", "www.youtube.com:443")));
        for (String invalid : new String[] { "", "invalid", "file:///tmp/cookies.txt",
            URL.replace("https:", "http:"), URL.replace("www.youtube.com", "www.youtube.com.evil.test"),
            URL.replace("www.youtube.com", "user:password@www.youtube.com"),
            URL.replace("www.youtube.com", "www.youtube.com:8443"), URL.replace("/api/timedtext", "/watch"),
            URL.replace("fmt=vtt", "fmt=json3"), URL.replace("/timedtext", "/%74imedtext") }) {
            assertThrows(invalid, IllegalArgumentException.class, () -> YtDlpSubtitle.format(invalid));
        }
    }

    @Test public void preservesTheSelectedTrackAndItsTokenWithoutReextractingTheVideo() throws Exception {
        org.json.JSONObject info = YtDlpSubtitle.info(URL, "vtt");
        org.json.JSONObject track = info.getJSONObject("subtitles").getJSONArray("caption").getJSONObject(0);
        assertEquals(URL, track.getString("url"));
        assertEquals("vtt", track.getString("ext"));
        assertFalse(info.has("url"));
    }

    @Test public void rejectsErrorPagesAndPreservesVttAndSrtContent() throws Exception {
        String vtt = "\uFEFFWEBVTT\n\n00:00:00.000 --> 00:00:01.000\nÜbersetzung\n";
        String srt = "1\n00:00:00,000 --> 00:00:01,000\nÜbersetzung\n";
        assertEquals(vtt, YtDlpSubtitle.validateText("vtt", vtt));
        assertEquals(srt, YtDlpSubtitle.validateText("srt", srt));
        assertThrows(IOException.class, () -> YtDlpSubtitle.validateText("vtt", "<html>Sign in</html>"));
        assertThrows(IOException.class, () -> YtDlpSubtitle.validateText("vtt", "WEBVTTINVALID"));
        assertThrows(IOException.class, () -> YtDlpSubtitle.validateText("srt", vtt));
    }
}
