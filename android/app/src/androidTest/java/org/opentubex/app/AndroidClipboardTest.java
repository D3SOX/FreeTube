package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class AndroidClipboardTest {
    @Test
    public void canvasScreenshotsBecomeReadablePngClipboardImages() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ClipboardManager clipboard = context.getSystemService(ClipboardManager.class);
        List<Uri> images = new ArrayList<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitValue(scenario, "typeof window.Capacitor === 'object' && document.readyState === 'complete'", "true");
            ClipData original = clipboard.getPrimaryClip();
            try {
                for (String color : new String[]{"red", "blue"}) {
                    // Exercise canvas -> PNG Blob -> FileReader -> Capacitor bridge,
                    // with no dependency on WebView clipboard support or a network video.
                    evaluate(scenario,
                        "window.clipboardTestResult = 'pending';" +
                        "var canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;" +
                        "var ctx = canvas.getContext('2d'); ctx.fillStyle = '" + color + "'; ctx.fillRect(0, 0, 2, 2);" +
                        "canvas.toBlob(function(blob) { var reader = new FileReader();" +
                        "reader.onload = function() {" +
                        "window.Capacitor.nativePromise('Clipboard', 'write', {image: reader.result})" +
                        ".then(function() { window.clipboardTestResult = 'copied'; }," +
                        "function(error) { window.clipboardTestResult = error.code; });" +
                        "}; reader.readAsDataURL(blob); }, 'image/png');"
                    );
                    awaitValue(scenario, "window.clipboardTestResult", "\"copied\"");
                    ClipData clip = clipboard.getPrimaryClip();
                    assertNotNull(clip);
                    assertTrue(clip.getDescription().hasMimeType("image/png"));
                    assertNull("An image must not be copied as base64 text", clip.getItemAt(0).getText());
                    Uri uri = clip.getItemAt(0).getUri();
                    assertNotNull(uri);
                    assertEquals("content", uri.getScheme());
                    assertEquals(context.getPackageName() + ".fileprovider", uri.getAuthority());
                    assertEquals("image/png", context.getContentResolver().getType(uri));
                    images.add(uri);
                }
                assertNotEquals("Each copy keeps its own image", images.get(0), images.get(1));
                assertImage(context, images.get(0), Color.RED);
                assertImage(context, images.get(1), Color.BLUE);

                evaluate(scenario,
                    "window.clipboardTestResult = 'pending';" +
                    "window.Capacitor.nativePromise('Clipboard', 'write', {image: 'data:image/png;base64,A'})" +
                    ".then(function() { window.clipboardTestResult = 'copied'; }," +
                    "function(error) { window.clipboardTestResult = error.code; });"
                );
                awaitValue(scenario, "window.clipboardTestResult", "\"WRITE_FAILED\"");
                assertEquals("A failed copy preserves the previous image", images.get(1),
                    clipboard.getPrimaryClip().getItemAt(0).getUri());
            } finally {
                clipboard.setPrimaryClip(original != null ? original : ClipData.newPlainText("", ""));
                for (Uri uri : images) context.getContentResolver().delete(uri, null, null);
            }
        }
    }

    private static void assertImage(Context context, Uri uri, int color) throws Exception {
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            Bitmap image = BitmapFactory.decodeStream(input);
            assertNotNull("The clipboard URI contains a decodable PNG", image);
            assertEquals(2, image.getWidth());
            assertEquals(2, image.getHeight());
            assertEquals(color, image.getPixel(0, 0));
            image.recycle();
        }
    }

    private static void awaitValue(ActivityScenario<MainActivity> scenario, String script, String expected) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        String actual;
        do {
            actual = evaluate(scenario, script);
            if (expected.equals(actual)) return;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        assertEquals(expected, actual);
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("WebView responds", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
