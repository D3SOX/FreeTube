package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Timeline;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.LoadControl;
import androidx.media3.exoplayer.analytics.PlayerId;
import androidx.media3.exoplayer.source.MediaSource.MediaPeriodId;
import androidx.media3.exoplayer.source.SinglePeriodTimeline;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativePlaybackBufferingTest {
    @Test
    public void inMemorySabrManifestRefillsBeforeNetworkBufferRunsOut() {
        DefaultLoadControl control = NativePlaybackEngine.createLoadControl();
        PlayerId player = new PlayerId("sabr-buffer-test");
        Timeline timeline = new SinglePeriodTimeline(600_000_000L, true, false, false, null,
            MediaItem.fromUri("data:application/dash+xml,%3CMPD%2F%3E"));
        MediaPeriodId period = new MediaPeriodId(timeline.getUidOfPeriod(0));
        control.onPrepared(player);
        try {
            // Fill the buffer, then consume it while loading is stopped. The
            // manifest is local, but its SABR segments still require network IO.
            assertFalse(control.shouldContinueLoading(parameters(player, timeline, period, 200)));
            assertTrue(control.shouldContinueLoading(parameters(player, timeline, period, 20)));
        } finally {
            control.onReleased(player);
        }
    }

    private static LoadControl.Parameters parameters(PlayerId player, Timeline timeline,
        MediaPeriodId period, long bufferedSeconds) {
        return new LoadControl.Parameters(player, timeline, period, 0, bufferedSeconds * 1_000_000,
            1, true, false, C.TIME_UNSET, C.TIME_UNSET);
    }
}
