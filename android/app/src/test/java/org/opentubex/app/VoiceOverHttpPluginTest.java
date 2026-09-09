package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import okhttp3.HttpUrl;
import org.junit.Test;

public class VoiceOverHttpPluginTest {
    @Test public void acceptsTranslationApiAndAudioHosts() {
        for (String host : new String[] { "api.browser.yandex.ru", "strm.yandex.net", "audio.strm.yandex.ru",
            "vtrans.s3-private.mds.yandex.net", "storage.yandexcloud.net" }) {
            assertTrue(VoiceOverHttpPlugin.isAllowedUrl(HttpUrl.parse("https://" + host + "/audio")));
        }
    }

    @Test public void rejectsUntrustedOrCredentialedEndpoints() {
        for (String url : new String[] { "http://strm.yandex.net/audio", "https://strm.yandex.net.evil.test/audio",
            "https://example.com/audio", "https://user:pass@strm.yandex.net/audio", "https://strm.yandex.net:444/audio" }) {
            assertFalse(VoiceOverHttpPlugin.isAllowedUrl(HttpUrl.parse(url)));
        }
        assertFalse(VoiceOverHttpPlugin.isAllowedUrl(null));
    }
}
