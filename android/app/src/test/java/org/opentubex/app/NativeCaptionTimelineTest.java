package org.opentubex.app;

import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class NativeCaptionTimelineTest {
    @Test public void seekingSelectsOverlappingCuesAndClearsAtTheirEnd() {
        NativeCaptionTimeline.Entry first = new NativeCaptionTimeline.Entry(2000, 5000, "Hello");
        NativeCaptionTimeline.Entry second = new NativeCaptionTimeline.Entry(4000, 6000, "World");
        NativeCaptionTimeline timeline = new NativeCaptionTimeline(Arrays.asList(first, second));
        assertEquals(Collections.emptyList(), timeline.at(1999));
        assertEquals(Arrays.asList(first), timeline.at(2000));
        assertEquals(Arrays.asList(first, second), timeline.at(4000));
        assertEquals(Arrays.asList(second), timeline.at(5000));
        assertEquals(Collections.emptyList(), timeline.at(6000));
        assertEquals(Arrays.asList(first), timeline.at(3000));
        assertEquals(2000, timeline.nextBoundary(1000));
        assertEquals(5000, timeline.nextBoundary(4000));
        assertEquals(Long.MAX_VALUE, timeline.nextBoundary(6000));
    }
}
