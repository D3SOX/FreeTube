package org.opentubex.app;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class YtDlpAutomaticDownloadsTest {
    @Test public void onlyDownloadsEligibleVideosPublishedAfterTheRuleWasEnabled() throws Exception {
        JSONObject rule = new JSONObject().put("enabledAt", 1000000).put("includeVideos", true).put("titleIncludes", "music,concert").put("titleExcludes", "trailer");
        JSONObject video = new JSONObject().put("videoId", "jNQXAC9IVRw").put("published", 1001).put("title", "Music live");
        assertTrue(YtDlpAutomaticDownloads.matches(video, "videos", rule, 2000000));
        assertFalse(YtDlpAutomaticDownloads.matches(video, "shorts", rule, 2000000));
        assertFalse(YtDlpAutomaticDownloads.matches(video.put("published", 999), "videos", rule, 2000000));
        video.put("published", 1001).put("title", "Concert trailer");
        assertFalse(YtDlpAutomaticDownloads.matches(video, "videos", rule, 2000000));
        video.put("title", "Music").put("isUpcoming", true);
        assertFalse(YtDlpAutomaticDownloads.matches(video, "videos", rule, 2000000));
    }
}
