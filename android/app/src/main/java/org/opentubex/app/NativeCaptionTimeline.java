package org.opentubex.app;

import java.util.ArrayList;
import java.util.List;

/** Parsed external captions, evaluated against the primary decoder's clock. */
final class NativeCaptionTimeline {
    static final class Entry {
        final long startMs;
        final long endMs;
        final String text;

        Entry(long startMs, long endMs, String text) {
            this.startMs = startMs;
            this.endMs = endMs;
            this.text = text;
        }
    }

    private final List<Entry> entries;

    NativeCaptionTimeline(List<Entry> entries) {
        this.entries = new ArrayList<>(entries);
    }

    List<Entry> at(long positionMs) {
        List<Entry> active = new ArrayList<>();
        for (Entry entry : entries) {
            if (entry.startMs <= positionMs && positionMs < entry.endMs) active.add(entry);
        }
        return active;
    }

    long nextBoundary(long positionMs) {
        long next = Long.MAX_VALUE;
        for (Entry entry : entries) {
            if (entry.startMs > positionMs) next = Math.min(next, entry.startMs);
            if (entry.endMs > positionMs) next = Math.min(next, entry.endMs);
        }
        return next;
    }
}
