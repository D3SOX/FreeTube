package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.media3.datasource.DefaultDataSource;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class PullToRefreshLayoutTest {
    @Test
    public void nativePullRequiresAnApprovedVerticalGestureAtThePageTop() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<PullToRefreshLayout> layoutRef = new AtomicReference<>();
            AtomicReference<WebView> webRef = new AtomicReference<>();
            AtomicInteger refreshes = new AtomicInteger();
            CountDownLatch loaded = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                PullToRefreshLayout layout = new PullToRefreshLayout(activity, null);
                WebView web = new WebView(activity);
                web.getSettings().setJavaScriptEnabled(true);
                web.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        loaded.countDown();
                    }
                });
                layout.addView(web, new ViewGroup.LayoutParams(-1, -1));
                activity.setContentView(layout);
                layout.configure(web, true);
                layout.setOnRefreshListener(refreshes::incrementAndGet);
                layoutRef.set(layout);
                webRef.set(web);
                web.loadDataWithBaseURL("https://pull-test.invalid", "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
                    "<body style='height:5000px'><script>window.acceptPull=true;" +
                    "window.__opentubexPullToRefresh=()=>window.acceptPull?{tabId:'test',offset:0,color:'#f00',backgroundColor:'#0f0'}:null;</script></body>",
                    "text/html", "UTF-8", null);
            });
            assertTrue("page loaded", loaded.await(10, TimeUnit.SECONDS));
            PullToRefreshLayout layout = layoutRef.get();
            WebView web = webRef.get();
            try {
                swipe(layout, false, false, false);
                assertEquals("one deliberate pull refreshes", 1, refreshes.get());
                onMain(() -> {
                    assertTrue(layout.isRefreshing());
                    layout.setRefreshing(false);
                });
                SystemClock.sleep(250);

                evaluate(web, "window.acceptPull=false");
                swipe(layout, false, false, false);
                assertEquals("DOM rejection prevents refresh", 1, refreshes.get());

                evaluate(web, "window.acceptPull=true;window.scrollTo(0,300)");
                swipe(layout, false, false, false);
                assertEquals("scrolling back to the top is not a refresh", 1, refreshes.get());
                evaluate(web, "window.scrollTo(0,0)");

                swipe(layout, true, false, false);
                assertEquals("horizontal swipe does not refresh", 1, refreshes.get());
                swipe(layout, false, true, false);
                assertEquals("cancel does not refresh", 1, refreshes.get());
                swipe(layout, false, false, true);
                assertEquals("a second finger cancels refresh", 1, refreshes.get());

                swipe(layout, false, false, false);
                assertEquals("a later valid gesture still works", 2, refreshes.get());
                onMain(() -> assertTrue("enter playback during an active refresh", layout.isRefreshing()));

                AtomicReference<NativePlaybackScreen> screenRef = new AtomicReference<>();
                AtomicReference<NativePlaybackEngine> engineRef = new AtomicReference<>();
                scenario.onActivity(activity -> {
                    NativePlaybackEngine engine = new NativePlaybackEngine(activity, new DefaultDataSource.Factory(activity), state -> {});
                    NativePlaybackScreen screen = new NativePlaybackScreen(activity, engine, web, "en-US", action -> {});
                    activity.addContentView(screen, new ViewGroup.LayoutParams(-1, -1));
                    screen.setFullscreen(false);
                    screen.setWebOverlayActive(true);
                    screen.setControlsVisible(false);
                    engineRef.set(engine);
                    screenRef.set(screen);
                });
                try {
                    SystemClock.sleep(250);
                    onMain(() -> assertFalse("playback must clear the original host's refresh state", layout.isRefreshing()));
                    swipe(screenRef.get(), false, false, false);
                    assertEquals("watch page still refreshes after native playback moves the WebView", 3, refreshes.get());
                    onMain(() -> ((PullToRefreshLayout) web.getParent()).setRefreshing(false));
                    SystemClock.sleep(500);
                    for (float endFraction : new float[] { 0.08f, 0f, -0.04f }) {
                        swipeAndRetract(screenRef.get(), endFraction);
                        assertEquals("retracting a watch-page pull cancels the refresh", 3, refreshes.get());
                        assertIndicatorHidden("retracted pull, end=" + endFraction);
                    }
                    swipe(screenRef.get(), false, true, false);
                    assertIndicatorHidden("interrupted pull");
                    onMain(() -> {
                        int width = web.getMeasuredWidth();
                        int height = web.getMeasuredHeight();
                        layout.measure(View.MeasureSpec.makeMeasureSpec(width / 2, View.MeasureSpec.EXACTLY),
                            View.MeasureSpec.makeMeasureSpec(height / 2, View.MeasureSpec.EXACTLY));
                        assertEquals("the empty original host must not resize the playback WebView", width, web.getMeasuredWidth());
                    });
                } finally {
                    onMain(() -> {
                        screenRef.get().close();
                        engineRef.get().release();
                    });
                }
                SystemClock.sleep(250);
                assertIndicatorHidden("returning from playback after refreshing the original page");
                swipe(layout, false, false, false);
                assertEquals("refresh still works after leaving native playback", 4, refreshes.get());
                onMain(() -> {
                    layout.configure(web, false);
                    assertFalse(layout.isRefreshing());
                });
                swipe(layout, false, false, false);
                assertEquals("disabled plugin leaves touches alone", 4, refreshes.get());
            } finally {
                onMain(() -> {
                    layout.removeView(web);
                    web.destroy();
                });
            }
        }
    }

    private static void assertIndicatorHidden(String gesture) {
        android.graphics.Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        int[] pixels = new int[screenshot.getWidth() * screenshot.getHeight()];
        screenshot.getPixels(pixels, 0, screenshot.getWidth(), 0, 0, screenshot.getWidth(), screenshot.getHeight());
        screenshot.recycle();
        int green = 0;
        for (int pixel : pixels) {
            if (android.graphics.Color.green(pixel) > 200 && android.graphics.Color.red(pixel) < 30 && android.graphics.Color.blue(pixel) < 30) green++;
        }
        assertEquals("indicator must disappear from the actual screen after " + gesture, 0, green);
    }

    private static void swipeAndRetract(View layout, float endFraction) {
        long down = SystemClock.uptimeMillis();
        float x = layout.getWidth() * 0.2f;
        float y = layout.getHeight() * 0.2f;
        touch(layout, down, MotionEvent.ACTION_DOWN, x, y);
        SystemClock.sleep(150);
        for (int i = 1; i <= 20; i++) {
            touch(layout, down, MotionEvent.ACTION_MOVE, x, y + layout.getHeight() * 0.6f * i / 20);
            SystemClock.sleep(16);
        }
        for (int i = 1; i <= 10; i++) {
            touch(layout, down, MotionEvent.ACTION_MOVE, x, y + layout.getHeight() * (0.6f + (endFraction - 0.6f) * i / 10));
            SystemClock.sleep(16);
        }
        touch(layout, down, MotionEvent.ACTION_UP, x, y + layout.getHeight() * endFraction);
        SystemClock.sleep(750);
    }

    private static void swipe(View layout, boolean horizontal, boolean cancel, boolean multi) {
        long down = SystemClock.uptimeMillis();
        float x = layout.getWidth() * 0.2f;
        float y = layout.getHeight() * 0.2f;
        touch(layout, down, MotionEvent.ACTION_DOWN, x, y);
        // The WebView hit test must return before interception can start.
        SystemClock.sleep(150);
        for (int i = 1; i <= 20; i++) {
            float fraction = i / 20f;
            touch(layout, down, MotionEvent.ACTION_MOVE,
                x + (horizontal ? layout.getWidth() * 0.6f * fraction : 0),
                y + layout.getHeight() * (horizontal ? 0.1f : 0.6f) * fraction);
            if (multi && i == 10) touch(layout, down, MotionEvent.ACTION_POINTER_DOWN, x, y);
            SystemClock.sleep(16);
        }
        touch(layout, down, cancel ? MotionEvent.ACTION_CANCEL : MotionEvent.ACTION_UP,
            x, y + layout.getHeight() * 0.6f);
        SystemClock.sleep(500);
    }

    private static void touch(View layout, long down, int action, float x, float y) {
        onMain(() -> {
            MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0);
            layout.dispatchTouchEvent(event);
            event.recycle();
        });
    }

    private static void evaluate(WebView web, String script) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        onMain(() -> web.evaluateJavascript(script, result -> evaluated.countDown()));
        assertTrue(evaluated.await(5, TimeUnit.SECONDS));
        SystemClock.sleep(100);
    }

    private static void onMain(Runnable action) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(action);
    }
}
