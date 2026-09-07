package org.opentubex.app;

import org.json.JSONObject;
import java.util.Arrays;
import java.util.Locale;
import java.util.function.Predicate;

final class YtDlpAutomaticDownloads {
    static boolean matches(JSONObject video, String source, JSONObject rule, long now) {
        if (!video.optString("videoId").matches("[\\w-]{11}") || video.optBoolean("isUpcoming") || video.optBoolean("premiere")) return false;
        String kind = source.equals("shorts") ? "includeShorts" : source.equals("live") || video.optBoolean("liveNow") ? "includeLivestreams" : "includeVideos";
        if (!rule.optBoolean(kind)) return false;
        long published = video.optLong("published") * 1000;
        long enabled = rule.optLong("enabledAt");
        if (enabled <= 0 || published / 1000 < enabled / 1000) return false;
        double age = rule.optDouble("maxAgeDays", 0);
        if (age > 0 && published < now - age * 86_400_000) return false;
        double duration = video.optDouble("lengthSeconds", 0);
        double min = rule.optDouble("minDurationSeconds", 0), max = rule.optDouble("maxDurationSeconds", 0);
        if (duration > 0 && (min > 0 && duration < min || max > 0 && duration > max)) return false;
        String title = video.optString("title").toLowerCase(Locale.ROOT);
        Predicate<String> contains = term -> title.contains(term.trim().toLowerCase(Locale.ROOT));
        String included = rule.optString("titleIncludes").trim();
        String excluded = rule.optString("titleExcludes").trim();
        return (included.isEmpty() || Arrays.stream(included.split(",")).filter(term -> !term.trim().isEmpty()).anyMatch(contains)) &&
            (excluded.isEmpty() || Arrays.stream(excluded.split(",")).filter(term -> !term.trim().isEmpty()).noneMatch(contains));
    }
}
