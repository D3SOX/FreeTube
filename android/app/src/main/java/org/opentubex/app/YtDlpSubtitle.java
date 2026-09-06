package org.opentubex.app;

import static java.util.Arrays.asList;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

/** Fetches only a selected YouTube subtitle, keeping imported cookies inside the app. */
final class YtDlpSubtitle {
    private static final int MAX_SUBTITLE_BYTES = 8 * 1024 * 1024;

    static String format(String value) {
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"www.youtube.com".equalsIgnoreCase(uri.getHost()) ||
                uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443) ||
                !"/api/timedtext".equals(uri.getRawPath()) || uri.getRawQuery() == null) {
                throw new IllegalArgumentException("Invalid subtitle URL");
            }
            for (String parameter : uri.getRawQuery().split("&")) {
                String[] pair = parameter.split("=", 2);
                if (!URLDecoder.decode(pair[0], "UTF-8").equals("fmt")) continue;
                String format = pair.length == 2 ? URLDecoder.decode(pair[1], "UTF-8") : "";
                if (format.equals("vtt") || format.equals("srt")) return format;
                break;
            }
        } catch (Exception error) {
            // Do not include signed URLs in bridge errors.
            throw new IllegalArgumentException("Invalid subtitle URL");
        }
        throw new IllegalArgumentException("Invalid subtitle URL");
    }

    static JSONObject info(String url, String format) throws Exception {
        return new JSONObject().put("id", "subtitle").put("title", "subtitle").put("extractor", "youtube")
            .put("subtitles", new JSONObject().put("caption", new JSONArray().put(new JSONObject().put("url", url).put("ext", format))));
    }

    static String validateText(String format, String text) throws IOException {
        String prefix = format.equals("vtt") ? "^\\uFEFF?WEBVTT(?:[\\t \\r\\n]|$)"
            : "^\\uFEFF?\\s*\\d+\\s*\\r?\\n\\d{2,}:\\d{2}:\\d{2},\\d{3} --> \\d{2,}:\\d{2}:\\d{2},\\d{3}";
        if (!Pattern.compile(prefix).matcher(text).find()) throw new IOException("Invalid subtitle");
        return text;
    }

    static String download(Context context, String url, String cookies) throws Exception {
        String format = format(url);
        File allowedCookies = new File(context.getNoBackupFilesDir(), "yt-dlp-cookies.txt");
        if (!cookies.equals(allowedCookies.getAbsolutePath()) || !allowedCookies.isFile()) throw new IOException("Cookie file is unavailable");
        File directory = new File(context.getCacheDir(), "yt-dlp-subtitle-" + UUID.randomUUID());
        if (!directory.mkdir()) throw new IOException("Unable to create subtitle directory");
        try {
            File infoPath = new File(directory, "info.json");
            YtDlpFiles.write(infoPath, info(url, format).toString().getBytes(StandardCharsets.UTF_8));
            // Internal arguments are fixed: the bridge never accepts paths or executable options.
            // extract() bounds runtime execution to 60 seconds and cancels its process on timeout.
            YtDlpRuntime.extract(context, asList("--no-playlist", "--no-progress", "--socket-timeout", "15", "--retries", "0",
                "--skip-download", "--ignore-no-formats-error", "--write-subs", "--sub-langs", "caption", "--sub-format", format,
                "--load-info-json", infoPath.getAbsolutePath(), "--output", new File(directory, "subtitle").getAbsolutePath(),
                "--cookies", allowedCookies.getAbsolutePath()));
            try (InputStream input = new FileInputStream(new File(directory, "subtitle.caption." + format))) {
                return validateText(format, new String(YtDlpFiles.read(input, MAX_SUBTITLE_BYTES), StandardCharsets.UTF_8));
            }
        } finally { YtDlpFiles.deleteTree(directory); }
    }
}
