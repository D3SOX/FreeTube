package org.opentubex.app;

import org.json.JSONArray;
import org.junit.Test;
import java.util.List;
import static org.junit.Assert.*;

public class YtDlpArgumentsTest {
    @Test public void acceptsPlaybackProjectionAndRelativePlaylistTemplates() {
        List<String> args = List.of("--print", "{\"title\":%(title)j}", "--output", "Music/%(title).200B.%(ext)s", "--extract-audio", "--audio-format", "opus");
        assertEquals(args, YtDlpArguments.validate(new JSONArray(args)));
    }

    @Test public void rejectsExecutableOverridesIncludingAbbreviations() {
        for (String option : List.of("--exec", "--exe", "--config-location", "--config-locations=/tmp/a", "--plugin-dirs", "--js-runtimes", "--ffmpeg-location", "-P/tmp", "-o/tmp/file", "--cookies", "--print-to-file", "--", "--enable-file-urls", "--postprocessor-args", "--out=../escape")) {
            assertThrows(option, IllegalArgumentException.class, () -> YtDlpArguments.validate(new JSONArray().put(option)));
        }
    }

    @Test public void confinesOutputToDownloadStagingDirectory() {
        for (String path : List.of("/tmp/escaped", "../escaped", "playlist/../../escaped", "C:\\escaped", "home:/tmp/file", "~/escaped")) {
            assertThrows(path, IllegalArgumentException.class, () -> YtDlpArguments.validate(new JSONArray().put("--output").put(path)));
        }
    }

    @Test public void treatsValuesAsValuesAndRejectsMalformedOptions() {
        assertEquals(List.of("--match-title", "--example"), YtDlpArguments.validate(new JSONArray().put("--match-title=--example")));
        assertThrows(IllegalArgumentException.class, () -> YtDlpArguments.validate(new JSONArray().put("--format").put(23)));
        assertThrows(IllegalArgumentException.class, () -> YtDlpArguments.validate(new JSONArray().put("--write-info-json=yes")));
    }
}
