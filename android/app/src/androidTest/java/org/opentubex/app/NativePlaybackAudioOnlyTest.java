package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.C;
import androidx.media3.datasource.DefaultDataSource;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativePlaybackAudioOnlyTest {
    @Test public void audioOnlyDisablesVideoSelectionAndRestoresItForTheNextSource() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            NativePlaybackEngine engine = new NativePlaybackEngine(context, new DefaultDataSource.Factory(context), state -> {});
            try {
                for (String mimeType : new String[] { "application/dash+xml", "application/x-mpegURL", "video/mp4" }) {
                    engine.setMimeType(mimeType);
                    engine.setAudioOnly(true);
                    assertTrue(engine.getPlayer().getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_VIDEO));
                    assertFalse(engine.getPlayer().getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO));
                    assertFalse(engine.getPlayer().getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_TEXT));
                    engine.setAudioOnly(false);
                    assertFalse(engine.getPlayer().getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_VIDEO));
                }
            } finally {
                engine.release();
            }
        });
    }
}
