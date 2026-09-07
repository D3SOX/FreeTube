package org.opentubex.app;

import static java.util.Arrays.asList;

import org.json.JSONArray;
import java.util.ArrayList;
import java.util.List;

/** The native bridge never accepts executable overrides or paths outside its staging directory. */
final class YtDlpArguments {
    // Restrict the bridge to media options. yt-dlp also accepts code execution,
    // arbitrary file access and abbreviated/short options, which must not cross it.
    private static final List<String> FLAGS = asList(
        "--no-playlist", "--yes-playlist", "--no-warnings", "--no-progress", "--ignore-no-formats-error",
        "--write-auto-subs", "--write-subs", "--extract-audio", "--skip-download", "--no-quiet",
        "--split-chapters", "--embed-subs", "--embed-thumbnail", "--embed-metadata", "--embed-chapters",
        "--no-overwrites", "--force-keyframes-at-cuts", "--flat-playlist", "--dump-single-json",
        "--ignore-errors", "--abort-on-error", "--continue", "--no-continue", "--write-thumbnail",
        "--write-info-json", "--write-description", "--restrict-filenames", "--windows-filenames",
        "--no-mtime", "--no-embed-subs", "--no-embed-thumbnail", "--no-embed-metadata",
        "--no-embed-chapters", "--no-write-subs", "--no-write-auto-subs", "--no-check-certificates"
    );
    private static final List<String> VALUES = asList(
        "--output", "--output-na-placeholder", "--format", "-f", "--format-sort", "-S",
        "--merge-output-format", "--remux-video", "--recode-video", "--audio-format", "--audio-quality",
        "--sponsorblock-remove", "--sponsorblock-mark", "--sub-langs", "--sub-format", "--convert-subs",
        "--extractor-args", "--match-filter", "--min-filesize", "--max-filesize", "--dateafter",
        "--datebefore", "--match-title", "--reject-title", "--download-sections", "--print",
        "--playlist-end", "--playlist-start", "--playlist-items", "--socket-timeout", "--retries",
        "--fragment-retries", "--concurrent-fragments", "--limit-rate", "--sleep-interval",
        "--max-sleep-interval", "--sleep-requests", "--geo-bypass-country", "--user-agent",
        "--referer", "--add-headers", "--proxy", "--trim-filenames"
    );

    static List<String> validate(JSONArray input) {
        if (input == null || input.length() > 2000) throw new IllegalArgumentException("invalid-arguments");
        List<String> result = new ArrayList<>();
        for (int i = 0; i < input.length(); i++) {
            Object raw = input.opt(i);
            if (!(raw instanceof String)) throw new IllegalArgumentException("invalid-arguments");
            String arg = (String) raw;
            if (arg.length() > 32768 || arg.indexOf('\0') >= 0) throw new IllegalArgumentException("invalid-arguments");
            String option = arg.split("=", 2)[0];
            if (!FLAGS.contains(option) && !VALUES.contains(option)) {
                if (!arg.matches("https?://[^\\s]+")) throw new IllegalArgumentException("unsupported-custom-argument");
                result.add(arg);
                continue;
            }
            if (FLAGS.contains(option)) {
                if (arg.contains("=")) throw new IllegalArgumentException("invalid-arguments");
                result.add(arg);
                continue;
            }
            if (!arg.contains("=") && !(input.opt(i + 1) instanceof String)) throw new IllegalArgumentException("invalid-arguments");
            String value = arg.contains("=") ? arg.substring(arg.indexOf('=') + 1) : input.optString(++i);
            if (value.isEmpty() || value.length() > 32768 || value.indexOf('\0') >= 0) throw new IllegalArgumentException("invalid-arguments");
            if (option.equals("--output") || option.equals("--output-na-placeholder")) {
                String template = value;
                if (template.startsWith("/") || template.startsWith("~") || template.contains("\\") || template.contains("..") || template.contains(":")) {
                    throw new IllegalArgumentException("invalid-output-template");
                }
                result.add(option);
                result.add(template);
            } else {
                result.add(option);
                result.add(value);
            }
        }
        return result;
    }
}
