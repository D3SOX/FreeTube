package org.opentubex.app;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import androidx.media3.datasource.DefaultDataSource;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativePlaybackReviewTest {
    @Test public void voiceOverFollowsNativeSpeedChangesWithoutTheRenderer() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            NativePlaybackEngine engine = new NativePlaybackEngine(context, new DefaultDataSource.Factory(context), state -> {});
            try {
                engine.getVoiceOver().load("translation", "asset:///demo.webm");
                engine.getPlayer().setPlaybackSpeed(2f);
                assertEquals(2.0, engine.getVoiceOver().snapshot().optDouble("playbackRate", 0.0), 0.001);
                engine.getPlayer().setPlaybackSpeed(1f);
                assertEquals(1.0, engine.getVoiceOver().snapshot().optDouble("playbackRate", 0.0), 0.001);
            } finally {
                engine.release();
            }
        });
    }

    @Test public void stoppingClearsExternalCaptionsWithoutChangingVisibility() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            NativePlaybackEngine engine = new NativePlaybackEngine(context, new DefaultDataSource.Factory(context), state -> {});
            try {
                java.lang.reflect.Field visibility = NativePlaybackEngine.class.getDeclaredField("captionsVisible");
                visibility.setAccessible(true);
                for (boolean visible : new boolean[] { false, true }) {
                    engine.setCaptionCues(java.util.Collections.singletonList(
                        new NativeCaptionTimeline.Entry(0, 10000, "Caption")), visible);
                    engine.stop();
                    assertEquals(visible, visibility.getBoolean(engine));
                    assertTrue(engine.getCaptionCues().isEmpty());
                }
            } catch (ReflectiveOperationException error) {
                throw new AssertionError(error);
            } finally {
                engine.release();
            }
        });
    }

    private static class FrameCall extends PluginCall {
        JSObject result;
        int resolved;
        int rejected;
        FrameCall(String format) { super(null, "AndroidPlayback", "test", "captureFrame", new JSObject().put("format", format)); }
        @Override public void resolve(JSObject value) { resolved++; result = value; }
        @Override public void reject(String message) { rejected++; }
    }

    @Test public void frameEncodingResolvesAndRecyclesBothFormats() {
        for (String format : new String[] { "png", "jpeg" }) {
            Bitmap bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888);
            FrameCall call = new FrameCall(format);
            AndroidPlaybackPlugin.encodeFrame(bitmap, call);
            assertEquals(1, call.resolved);
            assertEquals(0, call.rejected);
            assertTrue(call.result.getString("dataUrl").startsWith("data:image/" + format + ";base64,"));
            assertTrue(bitmap.isRecycled());
        }
    }

    @Test public void invalidBitmapRejectsInsteadOfLeavingTheCallPending() {
        Bitmap bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888);
        bitmap.recycle();
        FrameCall call = new FrameCall("png");
        AndroidPlaybackPlugin.encodeFrame(bitmap, call);
        assertEquals(0, call.resolved);
        assertEquals(1, call.rejected);
        assertTrue(bitmap.isRecycled());
    }

    @Test public void encodingAllocationFailureRejectsAndRecyclesTheFrame() {
        Bitmap bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888);
        FrameCall call = new FrameCall("png") {
            @Override public String getString(String key) { throw new OutOfMemoryError("Simulated encoding allocation failure"); }
        };
        AndroidPlaybackPlugin.encodeFrame(bitmap, call);
        assertEquals(0, call.resolved);
        assertEquals(1, call.rejected);
        assertTrue(bitmap.isRecycled());
    }
}
