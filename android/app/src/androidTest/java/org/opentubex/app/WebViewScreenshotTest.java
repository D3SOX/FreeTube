package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.view.TextureView;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.media3.datasource.DefaultDataSource;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class WebViewScreenshotTest {
    @Test
    public void windowCaptureIncludesNativeVideoAndWebControls() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> view = new AtomicReference<>();
            AtomicReference<NativePlaybackScreen> screen = new AtomicReference<>();
            AtomicReference<NativePlaybackEngine> engine = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            WebView webView = view.get();
            awaitCondition(webView, "!!document.querySelector('.app')");
            scenario.onActivity(activity -> webView.loadData("""
                <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
                <body style="margin:0;background:transparent">
                  <video style="width:100vw;height:100vh;opacity:0"></video>
                  <div id="control" style="position:fixed;left:40vw;top:40vh;width:20vw;height:20vh;background:cyan"></div>
                </body></html>
                """, "text/html", "UTF-8"));
            awaitCondition(webView, "!!document.querySelector('#control')");
            try {
                scenario.onActivity(activity -> {
                    engine.set(new NativePlaybackEngine(activity, new DefaultDataSource.Factory(activity), state -> {}));
                    screen.set(new NativePlaybackScreen(activity, engine.get(), webView, "en-US", action -> {}));
                    activity.addContentView(screen.get(), new ViewGroup.LayoutParams(-1, -1));
                    screen.get().setFullscreen(false);
                    screen.get().setInlineVisible(true);
                    screen.get().setControlsVisible(false);
                });
                CountDownLatch painted = new CountDownLatch(1);
                scenario.onActivity(activity -> webView.postVisualStateCallback(2, new WebView.VisualStateCallback() {
                    @Override public void onComplete(long requestId) {
                        webView.postOnAnimation(() -> {
                            TextureView texture = (TextureView) ((ViewGroup) screen.get().getChildAt(0)).getChildAt(0);
                            assertTrue("The native video texture is ready", texture.isAvailable());
                            // Paint a deterministic frame into the same texture used by Media3.
                            android.graphics.Canvas canvas = texture.lockCanvas();
                            assertNotNull(canvas);
                            canvas.drawColor(Color.MAGENTA);
                            texture.unlockCanvasAndPost(canvas);
                            webView.postOnAnimation(() -> webView.postOnAnimation(painted::countDown));
                        });
                    }
                }));
                assertTrue("The native frame and web controls have rendered", painted.await(10, TimeUnit.SECONDS));
                AtomicReference<Bitmap> captured = new AtomicReference<>();
                AtomicReference<Exception> error = new AtomicReference<>();
                CountDownLatch completed = new CountDownLatch(1);
                scenario.onActivity(activity -> WebViewScreenshot.capture(activity, webView,
                    bitmap -> { captured.set(bitmap); completed.countDown(); },
                    failure -> { error.set(failure); completed.countDown(); }));
                assertTrue("Window capture completes", completed.await(10, TimeUnit.SECONDS));
                assertEquals(null, error.get());
                Bitmap bitmap = captured.get();
                assertNotNull(bitmap);
                try {
                    assertEquals("The window already contains the native video frame", Color.MAGENTA,
                        bitmap.getPixel(bitmap.getWidth() / 4, bitmap.getHeight() / 2));
                    assertEquals("Web controls remain above the native video", Color.CYAN,
                        bitmap.getPixel(bitmap.getWidth() / 2, bitmap.getHeight() / 2));
                } finally {
                    bitmap.recycle();
                }
            } finally {
                scenario.onActivity(activity -> {
                    if (screen.get() != null) screen.get().close();
                    if (engine.get() != null) engine.get().release();
                });
            }
        }
    }

    @Test
    public void populatedFeedControlsKeepTheirRenderedProportions() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            WebView webView = view.get();
            awaitCondition(webView, "!!document.querySelector('.app')");
            evaluate(webView, """
                (() => {
                    const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                    const store = app.$store;
                    const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa';
                    store.commit('setFetchSubscriptionsAutomatically', false);
                    store.commit('setShowNewSubscriptionFeed', true);
                    store.commit('setNewSubscriptionFeedView', 'tabbed');
                    store.commit('setProfileList', [{
                        _id: 'allChannels', name: 'All Channels',
                        subscriptions: [{ id: channelId, name: 'Test channel', thumbnail: '' }]
                    }]);
                    store.commit('updateVideoCacheByChannel', {
                        channelId,
                        entries: Array.from({ length: 50 }, (_, index) => ({
                            videoId: 'video' + String(index).padStart(6, '0'),
                            title: 'Preview test ' + index, author: 'Test channel', authorId: channelId,
                            published: Date.now() - index * 3600000, viewCount: 1000,
                            lengthSeconds: 120, liveNow: false, isUpcoming: false,
                            type: 'video', isNewInSubscriptionFeed: true
                        }))
                    });
                    localStorage.setItem('Subscriptions/currentTab', 'new');
                    app.$router.push('/subscriptions');
                })()
                """);
            awaitCondition(webView, "!!document.querySelector('[data-subscription-feed-tab=\"all\"]')");
            evaluate(webView, "document.querySelector('[data-subscription-feed-tab=\"all\"]').click()");
            awaitCondition(webView, "!!document.querySelector('.newFeedTab') && document.querySelectorAll('.ft-list-video').length > 0");
            // A fresh WebView profile can show the first-run tutorial over the feed.
            evaluate(webView, "document.querySelector('.tutorialActions button')?.click()");
            awaitCondition(webView, "!document.querySelector('.tutorialOverlay')");
            evaluate(webView, """
                (() => {
                    const marker = document.createElement('span');
                    marker.style.cssText = 'display:block;width:20px;height:20px;flex:none;background:#ff00ff';
                    document.querySelector('.newFeedTab').append(marker);
                })()
                """);
            CountDownLatch rendered = new CountDownLatch(1);
            scenario.onActivity(activity -> webView.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    webView.postOnAnimation(() -> webView.postOnAnimation(rendered::countDown));
                }
            }));
            assertTrue("The populated feed has rendered", rendered.await(10, TimeUnit.SECONDS));

            evaluate(webView, """
                window.__screenshotTest = null;
                Capacitor.Plugins.Screenshot.take().then(
                    result => { window.__screenshotTest = result; },
                    error => { window.__screenshotTest = { error: String(error) }; }
                );
                """);
            awaitCondition(webView, "window.__screenshotTest !== null");
            JSONObject result = new JSONObject((String) new JSONTokener(
                evaluate(webView, "JSON.stringify(window.__screenshotTest)")).nextValue());
            assertTrue("The screenshot plugin succeeds: " + result, !result.has("error"));
            File screenshot = new File(result.getString("uri"));
            Bitmap bitmap = null;
            try {
                BitmapFactory.Options options = new BitmapFactory.Options();
                bitmap = BitmapFactory.decodeFile(screenshot.getAbsolutePath(), options);
                assertNotNull("The plugin returns a readable image", bitmap);
                assertEquals("The screenshot is a JPEG", "image/jpeg", options.outMimeType);
                assertEquals(webView.getWidth(), bitmap.getWidth());
                assertEquals(webView.getHeight(), bitmap.getHeight());
                int left = bitmap.getWidth(), top = bitmap.getHeight(), right = -1, bottom = -1;
                int[] pixels = new int[bitmap.getWidth() * bitmap.getHeight()];
                bitmap.getPixels(pixels, 0, bitmap.getWidth(), 0, 0, bitmap.getWidth(), bitmap.getHeight());
                for (int index = 0; index < pixels.length; index++) {
                    int color = pixels[index];
                    if (android.graphics.Color.red(color) > 220 && android.graphics.Color.green(color) < 50 &&
                        android.graphics.Color.blue(color) > 220) {
                        int x = index % bitmap.getWidth(), y = index / bitmap.getWidth();
                        left = Math.min(left, x);
                        right = Math.max(right, x);
                        top = Math.min(top, y);
                        bottom = Math.max(bottom, y);
                    }
                }
                assertTrue("The marker is visible in the capture", right > left && bottom > top);
                assertEquals("A square inside a feed tab must remain square in the screenshot",
                    right - left, bottom - top, 2);
            } finally {
                if (bitmap != null) bitmap.recycle();
                assertTrue("The temporary screenshot can be deleted", screenshot.delete());
            }
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("JavaScript responds", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void awaitCondition(WebView view, String script) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 15000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script, "true", evaluate(view, script));
    }
}
