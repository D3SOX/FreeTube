package org.opentubex.app;

import static org.junit.Assert.*;

import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.ui.PlayerControlView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativePlaybackScreenTest {
    private static class TouchWebView extends WebView {
        int downs;
        final java.util.List<Integer> actions = new java.util.ArrayList<>();
        VisualStateCallback heldVisualState;
        long heldVisualStateId;
        boolean holdVisualState;
        TouchWebView(android.content.Context context) { super(context); }
        @Override public void postVisualStateCallback(long id, VisualStateCallback callback) {
            if (!holdVisualState) { super.postVisualStateCallback(id, callback); return; }
            heldVisualState = callback;
            heldVisualStateId = id;
        }
        @Override public boolean dispatchTouchEvent(MotionEvent event) {
            actions.add(event.getActionMasked());
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) downs++;
            return true;
        }
    }

    private interface Check { void run(NativePlaybackScreen screen, PlayerControlView controls, TouchWebView web, NativePlaybackEngine engine); }

    private void withScreen(Check... checks) {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            NativePlaybackScreen[] screenRef = new NativePlaybackScreen[1];
            PlayerControlView[] controlsRef = new PlayerControlView[1];
            TouchWebView[] webRef = new TouchWebView[1];
            NativePlaybackEngine[] engineRef = new NativePlaybackEngine[1];
            Runnable[] cleanup = new Runnable[1];
            try {
                scenario.onActivity(activity -> {
                    NativePlaybackEngine engine = new NativePlaybackEngine(activity, new DefaultDataSource.Factory(activity), state -> {});
                    PullToRefreshLayout original = new PullToRefreshLayout(activity, null);
                    TouchWebView web = new TouchWebView(activity);
                    original.addView(web);
                    activity.addContentView(original, new ViewGroup.LayoutParams(-1, -1));
                    NativePlaybackScreen screen = new NativePlaybackScreen(activity, engine, web, "en-US", action -> {});
                    activity.addContentView(screen, new ViewGroup.LayoutParams(-1, -1));
                    screen.measure(View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(600, View.MeasureSpec.EXACTLY));
                    screen.layout(0, 0, 1000, 600);
                    PlayerControlView controls = null;
                    for (int i = 0; i < screen.getChildCount(); i++) {
                        if (screen.getChildAt(i) instanceof PlayerControlView) controls = (PlayerControlView) screen.getChildAt(i);
                    }
                    assertNotNull(controls);
                    controls.setAnimationEnabled(false);
                    engineRef[0] = engine;
                    screenRef[0] = screen;
                    controlsRef[0] = controls;
                    webRef[0] = web;
                    cleanup[0] = () -> { screen.close(); engine.release(); original.removeView(web); web.destroy(); ((ViewGroup) original.getParent()).removeView(original); };
                    checks[0].run(screen, controls, web, engine);
                });
                for (int index = 1; index < checks.length; index++) {
                    InstrumentationRegistry.getInstrumentation().waitForIdleSync();
                    java.util.concurrent.CountDownLatch frame = new java.util.concurrent.CountDownLatch(1);
                    scenario.onActivity(activity -> screenRef[0].postOnAnimation(() ->
                        screenRef[0].postOnAnimation(frame::countDown)));
                    try { assertTrue("The native window must settle its layout", frame.await(5, java.util.concurrent.TimeUnit.SECONDS)); }
                    catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new AssertionError(error); }
                    Check check = checks[index];
                    scenario.onActivity(activity -> check.run(screenRef[0], controlsRef[0], webRef[0], engineRef[0]));
                }
            } finally {
                scenario.onActivity(activity -> { if (cleanup[0] != null) cleanup[0].run(); });
            }
        }
    }

    @Test public void inlinePlaybackKeepsTheNativeVideoBelowTheSharedWebControls() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            View videoFrame = screen.getChildAt(0);
            assertEquals("Inline video must be drawn at its native cadence", 1f, videoFrame.getAlpha(), 0f);
            assertSame("Web controls must remain above the native video", screen, ((View) web.getParent()).getParent());
            assertTrue(screen.indexOfChild((View) web.getParent()) > screen.indexOfChild(videoFrame));
            screen.setControlsVisible(false);
            tap(screen, 100, 100);
            assertEquals("Inline surface touches reach the shared gesture recognizer", 1, web.downs);
        });
    }

    @Test public void inlineVideoAndControlsFollowScrollBeforeTheNextBridgeLayout() {
        View[] frame = new View[1];
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setFollowsPageScroll(true);
            screen.layoutVideo(0, 180, 400, 225, 1000);
            screen.layoutControls(0, 180, 400, 225, 1000);
            frame[0] = screen.getChildAt(0);
            web.loadData("<html><body style='height:4000px'></body></html>", "text/html", "UTF-8");
        }, (screen, controls, web, engine) -> {
            web.scrollTo(0, 120);
            assertEquals(120, web.getScrollY());
        }, (screen, controls, web, engine) -> {
            assertEquals(120, web.getScrollY());
            float expected = 180 * screen.getWidth() / 1000f - web.getScrollY();
            assertEquals("The native video must follow Chromium scrolling without waiting for JS", expected, frame[0].getTranslationY(), 1f);
            assertEquals("Native transport buttons must scroll with the shared toolbar", expected, controls.getY(), 1f);
        });
    }

    @Test public void scrollingCountdownClipsAndConsumesTouchesAtItsNewPosition() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setControlsVisible(true);
            screen.setFollowsPageScroll(true);
            screen.layoutVideo(0, 180, 400, 225, 1000);
            screen.layoutControls(0, 180, 400, 225, 1000);
            controls.setBackgroundColor(android.graphics.Color.MAGENTA);
            screen.setMenuBounds(new android.graphics.RectF[] { new android.graphics.RectF(0, 0, 1000, 100) });
            screen.setScrollingMenuBounds(new android.graphics.RectF[] { new android.graphics.RectF(200, 300, 280, 380) });
            web.loadData("<html><body style='height:4000px'></body></html>", "text/html", "UTF-8");
        }, (screen, controls, web, engine) -> web.scrollTo(0, 120),
        (screen, controls, web, engine) -> {
            assertEquals(120, web.getScrollY());
            assertTrue("The moving countdown must still take touch priority", screen.isOverMenu(240, 220));
            assertFalse("The previous countdown position cannot remain a dead zone", screen.isOverMenu(240, 330));
            assertTrue("The app header must stay fixed", screen.isOverMenu(240, 50));
            // Sample the controller background rather than its glyph pixels.
            for (int i = 0; i < controls.getChildCount(); i++) controls.getChildAt(i).setVisibility(View.INVISIBLE);
            android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(image));
            assertNotEquals("The native controls cannot cover the scrolling countdown", android.graphics.Color.MAGENTA, image.getPixel(240, 220));
            assertEquals("The old countdown opening must close", android.graphics.Color.MAGENTA, image.getPixel(240, 330));
            image.recycle();
            screen.animateVideo(new double[] { 0, 60, 400, 225 }, new double[] { 100, 200, 300, 168.75, 1000 }, 1200, 12, () -> {});
            assertTrue("Changing the video coordinate mode cannot move document-coordinate exclusions", screen.isOverMenu(240, 220));
            assertFalse(screen.isOverMenu(240, 330));
        });
    }

    @Test public void movingMiniPlayerDoesNotResizeTheDecoderSurface() {
        int[] surfaceSize = new int[2];
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.layoutVideo(0, 100, 400, 225, 400);
        }, (screen, controls, web, engine) -> {
            View frame = screen.getChildAt(0);
            surfaceSize[0] = frame.getWidth();
            surfaceSize[1] = frame.getHeight();
            screen.layoutVideo(170, 350, 220, 123.75, 400);
        }, (screen, controls, web, engine) -> {
            View frame = screen.getChildAt(0);
            assertEquals("Mini-player motion must scale the existing texture instead of reallocating it", surfaceSize[0], frame.getWidth());
            assertEquals(surfaceSize[1], frame.getHeight());
            assertEquals(220 * screen.getWidth() / 400f, frame.getWidth() * frame.getScaleX(), 1f);
        });
    }

    @Test public void animatedVideoStaysAbovePageContentAndBelowAppChrome() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setControlsVisible(true);
            ViewGroup frame = (ViewGroup) screen.getChildAt(0);
            frame.setBackgroundColor(android.graphics.Color.MAGENTA);
            frame.getChildAt(0).setVisibility(View.INVISIBLE);
            web.setBackgroundColor(android.graphics.Color.RED);
            screen.setMenuBounds(new android.graphics.RectF[] { new android.graphics.RectF(0, 0, 1000, 80) });
            screen.animateVideo(new double[] { 0, 0, 500, 281.25 }, new double[] { 100, 0, 400, 225, 1000 }, 1200, 12, () -> {});
            assertTrue("Moving video must draw over opaque route content", screen.indexOfChild(frame) > screen.indexOfChild((View) web.getParent()));
            assertFalse("Transport buttons must not travel separately from the video", controls.isFullyVisible());
        }, (screen, controls, web, engine) -> {
            android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(image));
            assertEquals("Page content cannot occlude the moving native frame", android.graphics.Color.MAGENTA, image.getPixel(200, 150));
            assertNotEquals("Video cannot paint over the app header or status bar", android.graphics.Color.MAGENTA, image.getPixel(200, 40));
            image.recycle();
        });
    }

    @Test public void pageScrollCannotCoverAStationaryMiniPlayer() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setControlsVisible(false);
            screen.layoutVideo(200, 200, 400, 225, 1000);
            screen.setMiniPlayer(true, 12);
            ViewGroup frame = (ViewGroup) screen.getChildAt(0);
            frame.setBackgroundColor(android.graphics.Color.MAGENTA);
            frame.getChildAt(0).setVisibility(View.INVISIBLE);
            // Model a Chromium scroll frame painted before its transparent
            // opening catches up. The native video must survive that frame.
            web.setBackgroundColor(android.graphics.Color.RED);
            long now = SystemClock.uptimeMillis();
            for (int index = 0; index < 2; index++) {
                MotionEvent event = MotionEvent.obtain(now, now + index * 30,
                    index == 0 ? MotionEvent.ACTION_DOWN : MotionEvent.ACTION_MOVE,
                    100, 400 - index * 100, 0);
                screen.dispatchTouchEvent(event);
                event.recycle();
            }
        }, (screen, controls, web, engine) -> {
            android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(image));
            float scale = screen.getWidth() / 1000f;
            assertEquals("Scrolling page content cannot cover the stationary mini player",
                android.graphics.Color.MAGENTA, image.getPixel((int) (400 * scale), (int) (300 * scale)));
            image.recycle();
        });
    }

    @Test public void scrollingHandoffWaitsForDrawAndANewSwipeCancelsIt() {
        View[] frame = new View[1];
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setControlsVisible(false);
            screen.layoutVideo(200, 200, 400, 225, 1000);
            screen.setMiniPlayer(true, 12);
            frame[0] = screen.getChildAt(0);
            swipePage(screen);
            web.holdVisualState = true;
            SystemClock.sleep(160);
            screen.finishPageScroll();
            assertNotNull(web.heldVisualState);
            web.heldVisualState.onComplete(web.heldVisualStateId);
            assertTrue(screen.indexOfChild(frame[0]) > screen.indexOfChild((View) web.getParent()));
            // Start another fling before Chromium's previous ready frame draws.
            swipePage(screen);
            android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(image));
            image.recycle();
        }, (screen, controls, web, engine) -> {
            assertTrue("An obsolete handoff cannot lower a video during another swipe", screen.indexOfChild(frame[0]) > screen.indexOfChild((View) web.getParent()));
            SystemClock.sleep(160);
            screen.finishPageScroll();
            web.heldVisualState.onComplete(web.heldVisualStateId);
            android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(image));
            image.recycle();
        }, (screen, controls, web, engine) -> {
            assertTrue("Settled scrolling must restore the shared mini-player controls", screen.indexOfChild((View) web.getParent()) > screen.indexOfChild(frame[0]));
        });
    }

    @Test public void pictureInPictureDuringMotionUsesTheWholeVideoWindow() {
        for (String mode : new String[] { "scroll", "handoff", "animation" }) withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.layoutVideo(200, 200, 400, 225, 1000);
            screen.setMiniPlayer(true, 12);
            ViewGroup frame = (ViewGroup) screen.getChildAt(0);
            frame.setBackgroundColor(android.graphics.Color.MAGENTA);
            frame.getChildAt(0).setVisibility(View.INVISIBLE);
            if (mode.equals("animation")) {
                screen.animateVideo(new double[] { 200, 200, 400, 225 }, new double[] { 100, 100, 600, 337.5, 1000 }, 1200, 12, () -> {});
            } else {
                swipePage(screen);
                if (mode.equals("handoff")) {
                    web.holdVisualState = true;
                    SystemClock.sleep(160);
                    screen.finishPageScroll();
                }
            }
            screen.setPictureInPicture(true);
            assertEquals("PiP cannot retain the mini-player scroll transform", 1f, frame.getScaleX(), 0f);
            assertEquals(0f, frame.getTranslationX(), 0f);
            assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, frame.getLayoutParams().width);
        }, (screen, controls, web, engine) -> {
            android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(image));
            assertEquals("PiP cannot retain the mini-player clipping rectangle", android.graphics.Color.MAGENTA,
                image.getPixel(screen.getWidth() - 30, screen.getHeight() / 2));
            image.recycle();
        });
    }

    private static void swipePage(NativePlaybackScreen screen) {
        long now = SystemClock.uptimeMillis();
        for (int index = 0; index < 3; index++) {
            int action = index == 0 ? MotionEvent.ACTION_DOWN : index == 1 ? MotionEvent.ACTION_MOVE : MotionEvent.ACTION_UP;
            MotionEvent event = MotionEvent.obtain(now, now + index * 30, action, 100, 400 - index * 70, 0);
            screen.dispatchTouchEvent(event);
            event.recycle();
        }
    }

    @Test public void reversingMotionStartsAtTheDisplayedVideoInsteadOfTheDomDestination() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.animateVideo(new double[] { 0, 100, 1000, 562.5 }, new double[] { 600, 500, 350, 196.875, 1000 }, 1200, 12, () -> {});
        }, (screen, controls, web, engine) -> {
            View frame = screen.getChildAt(screen.getChildCount() - 1);
            float left = frame.getTranslationX();
            float top = frame.getTranslationY();
            screen.animateVideo(new double[] { 600, 500, 350, 196.875 }, new double[] { 0, 100, 1000, 562.5, 1000 }, 1200, 0, () -> {});
            assertEquals("Reversing a transition must not jump to its old DOM destination", left, frame.getTranslationX(), 1f);
            assertEquals(top, frame.getTranslationY(), 1f);
        });
    }

    @Test public void closingDuringFullscreenPreparationSettlesThePendingEntry() {
        for (boolean readyBeforeClose : new boolean[] { false, true }) withScreen((screen, controls, web, engine) -> {
            int[] completions = new int[1];
            web.holdVisualState = true;
            screen.afterWebFrame(() -> completions[0]++);
            if (readyBeforeClose) web.heldVisualState.onComplete(web.heldVisualStateId);
            screen.close();
            assertEquals("A dismissed screen cannot wait for another draw", 1, completions[0]);
            if (!readyBeforeClose) web.heldVisualState.onComplete(web.heldVisualStateId);
            assertEquals("Late visual readiness cannot complete the same entry twice", 1, completions[0]);
        });
    }

    @Test public void fullscreenRotationWaitsUntilTheReadyWebFrameHasDrawn() {
        boolean[] ready = new boolean[1];
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            web.holdVisualState = true;
            screen.setFullscreen(true);
            screen.afterWebFrame(() -> ready[0] = true);
            assertFalse("Do not rotate the old inline page snapshot", ready[0]);
            web.heldVisualState.onComplete(web.heldVisualStateId);
            assertFalse("A ready Chromium frame must still reach the Android window", ready[0]);
            android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(image));
            image.recycle();
            assertFalse("The rotation must start after this frame is submitted", ready[0]);
        }, (screen, controls, web, engine) -> assertTrue(ready[0]));
    }

    @Test public void videoStaysAboveThePageUntilTheReadyWebFrameHasActuallyDrawn() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.animateVideo(new double[] { 0, 100, 1000, 562.5 }, new double[] { 600, 500, 350, 196.875, 1000 }, 0, 12, () -> {});
            View videoFrame = screen.getChildAt(screen.getChildCount() - 1);
            web.holdVisualState = true;
            screen.finishVideoTransition();
            web.heldVisualState.onComplete(web.heldVisualStateId);
            assertTrue("A ready Chromium frame has not necessarily drawn its new transparent window yet", screen.indexOfChild(videoFrame) > screen.indexOfChild((View) web.getParent()));
            assertFalse(controls.isFullyVisible());
            android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(image));
            image.recycle();
        }, (screen, controls, web, engine) -> {
            assertTrue("After the WebView draws, its controls must be above the video again", screen.indexOfChild((View) web.getParent()) > 0);
            assertTrue(controls.isFullyVisible());
        });
    }

    @Test public void externalCaptionsRemainDrawableInPictureInPicture() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setPictureInPicture(true);
            engine.setCaptionCues(java.util.Collections.singletonList(
                new NativeCaptionTimeline.Entry(0, 10000, "External caption in PiP")), true);
        }, (screen, controls, web, engine) -> {
            assertEquals("External caption in PiP", engine.getCaptionCues().get(0).text.toString());
            assertEquals(0f, ((View) web.getParent()).getAlpha(), 0f);
            assertTrue("PiP captions must draw without the WebView", brightPixels(screen) > 0);
            engine.setCaptionsVisible(false);
        }, (screen, controls, web, engine) -> {
            assertTrue(engine.getCaptionCues().isEmpty());
            assertEquals("Hiding captions must clear the native PiP subtitle view", 0, brightPixels(screen));
            engine.setCaptionCues(java.util.Collections.singletonList(
                new NativeCaptionTimeline.Entry(0, 10000, "Replacement translated caption")), true);
        }, (screen, controls, web, engine) -> {
            assertTrue("Dynamically selected translated captions must also draw", brightPixels(screen) > 0);
        });
    }

    private static int brightPixels(NativePlaybackScreen screen) {
        android.graphics.Bitmap image = android.graphics.Bitmap.createBitmap(screen.getWidth(), screen.getHeight(),
            android.graphics.Bitmap.Config.ARGB_8888);
        screen.draw(new android.graphics.Canvas(image));
        int[] pixels = new int[image.getWidth() * image.getHeight()];
        image.getPixels(pixels, 0, image.getWidth(), 0, 0, image.getWidth(), image.getHeight());
        image.recycle();
        int count = 0;
        for (int pixel : pixels) if (android.graphics.Color.red(pixel) > 180 &&
            android.graphics.Color.green(pixel) > 180 && android.graphics.Color.blue(pixel) > 180) count++;
        return count;
    }

    @Test public void inlineWindowRetainsOriginalWebViewInsetsAcrossFullscreen() {
        withScreen((screen, controls, web, engine) -> {
            ViewGroup parent = (ViewGroup) screen.getParent();
            ViewGroup original = (ViewGroup) parent.getChildAt(parent.indexOfChild(screen) - 1);
            original.setPadding(11, 37, 13, 29);
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
        }, (screen, controls, web, engine) -> {
            assertInlineWindowBounds(screen);
            screen.setFullscreen(true);
        }, (screen, controls, web, engine) -> {
            assertEquals(((View) screen.getParent()).getHeight(), screen.getHeight());
            screen.setFullscreen(false);
        }, (screen, controls, web, engine) -> assertInlineWindowBounds(screen));
    }

    private static void assertInlineWindowBounds(NativePlaybackScreen screen) {
        ViewGroup parent = (ViewGroup) screen.getParent();
        ViewGroup original = (ViewGroup) parent.getChildAt(parent.indexOfChild(screen) - 1);
        int[] screenOrigin = new int[2];
        int[] originalOrigin = new int[2];
        screen.getLocationOnScreen(screenOrigin);
        original.getLocationOnScreen(originalOrigin);
        assertEquals("Inline player must retain the system-inset WebView origin", originalOrigin[1] + original.getPaddingTop(), screenOrigin[1]);
        assertEquals(originalOrigin[0] + original.getPaddingLeft(), screenOrigin[0]);
        assertEquals(original.getHeight() - original.getPaddingTop() - original.getPaddingBottom(), screen.getHeight());
        assertEquals(original.getWidth() - original.getPaddingLeft() - original.getPaddingRight(), screen.getWidth());
    }

    @Test public void nativeControlsDoNotDimSharedTitlesAndActions() {
        withScreen((screen, controls, web, engine) -> {
            screen.setWebOverlayActive(true);
            screen.setWebOverlayActive(false);
            View scrim = controls.findViewById(androidx.media3.ui.R.id.exo_controls_background);
            android.graphics.drawable.ColorDrawable background = (android.graphics.drawable.ColorDrawable) scrim.getBackground();
            assertEquals("The native scrim must not darken the shared UI", 0, android.graphics.Color.alpha(background.getColor()));
            assertNull("Watch owns the feature-complete bottom toolbar", controls.findViewById(androidx.media3.ui.R.id.exo_bottom_bar));
            assertTrue("Native buttons must remain above the ambient canvas", screen.indexOfChild(controls) > screen.indexOfChild((View) web.getParent()));
        });
    }

    @Test public void surfaceTouchDoesNotOverrideSharedVisibilityDecision() {
        withScreen((screen, controls, web, engine) -> {
            screen.setWebOverlayActive(false);
            controls.hide();
            tap(screen, 400, 180);
            assertEquals(1, web.downs);
            assertFalse("Shared gesture handling decides whether a surface tap shows or hides controls", controls.isFullyVisible());
        });
    }

    @Test public void invisibleNativeButtonsDoNotInterceptSharedPanelTouches() {
        withScreen((screen, controls, web, engine) -> {
            screen.setWebOverlayActive(true);
            screen.setControlsVisible(false);
            tap(screen, 500, 300);
            assertEquals(1, web.downs);
        });
    }

    @Test public void sharedTimelineReceivesTouchesInTheNativeSeekArea() {
        withScreen((screen, controls, web, engine) -> {
            screen.setControlsVisible(true);
            assertNull(controls.findViewById(androidx.media3.ui.R.id.exo_progress));
            tap(screen, 100, 400);
            assertEquals("Scrubbing must reach Watch's timeline and its chapter/A-B controls", 1, web.downs);
        });
    }

    @Test public void nativeFullscreenButtonsDoNotDuplicateTheSharedToolbar() {
        withScreen((screen, controls, web, engine) -> {
            screen.setControlsVisible(true);
            assertNull(controls.findViewById(androidx.media3.ui.R.id.exo_fullscreen));
            assertNull(controls.findViewById(androidx.media3.ui.R.id.exo_minimal_fullscreen));
            screen.setControlsVisible(false);
            screen.setControlsVisible(true);
            assertNull(controls.findViewById(androidx.media3.ui.R.id.exo_fullscreen));
        });
    }

    @Test public void refreshIndicatorDrawsAboveNativeControlsAndVideoButHidesInPictureInPicture() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setWebOverlayActive(true);
            screen.setControlsVisible(true);
            controls.setBackgroundColor(android.graphics.Color.MAGENTA);
            PullToRefreshLayout refresh = (PullToRefreshLayout) web.getParent();
            android.widget.ImageView indicator = null;
            for (int i = 0; i < refresh.getChildCount(); i++) {
                if (refresh.getChildAt(i) instanceof android.widget.ImageView) {
                    indicator = (android.widget.ImageView) refresh.getChildAt(i);
                }
            }
            assertNotNull(indicator);
            // A solid marker makes the draw-order assertion independent of spinner animation.
            indicator.setImageDrawable(null);
            indicator.setBackgroundColor(android.graphics.Color.GREEN);
            indicator.setVisibility(View.VISIBLE);
            indicator.layout(450, 100, 550, 200);
            android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(1000, 600, android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(bitmap));
            assertEquals("Player controls cannot cover the refresh indicator", android.graphics.Color.GREEN, bitmap.getPixel(500, 150));
            assertEquals("The remaining controls stay visible", android.graphics.Color.MAGENTA, bitmap.getPixel(800, 150));

            screen.getChildAt(0).bringToFront();
            screen.draw(new android.graphics.Canvas(bitmap));
            assertEquals("Raising the native video cannot cover the indicator", android.graphics.Color.GREEN, bitmap.getPixel(500, 150));

            screen.setPictureInPicture(true);
            bitmap.eraseColor(android.graphics.Color.BLACK);
            screen.draw(new android.graphics.Canvas(bitmap));
            assertNotEquals("The indicator stays out of PiP", android.graphics.Color.GREEN, bitmap.getPixel(500, 150));
            bitmap.recycle();
        });
    }

    @Test public void menusCoverNativeControlsWithoutHidingTheRest() {
        withScreen((screen, controls, web, engine) -> {
            screen.setWebOverlayActive(true);
            screen.setControlsVisible(true);
            controls.setBackgroundColor(android.graphics.Color.MAGENTA);
            screen.setMenuBounds(new android.graphics.RectF[] { new android.graphics.RectF(0, 0, 500, 600) });
            android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(1000, 600, android.graphics.Bitmap.Config.ARGB_8888);
            screen.draw(new android.graphics.Canvas(bitmap));
            assertNotEquals("Native controls must not paint over menus", android.graphics.Color.MAGENTA, bitmap.getPixel(120, 120));
            assertEquals("Controls outside the menu stay visible", android.graphics.Color.MAGENTA, bitmap.getPixel(800, 120));
            bitmap.recycle();

            View play = controls.findViewById(androidx.media3.ui.R.id.exo_play_pause);
            int[] location = new int[2];
            int[] origin = new int[2];
            play.getLocationOnScreen(location);
            screen.getLocationOnScreen(origin);
            float x = location[0] - origin[0] + play.getWidth() / 2f;
            float y = location[1] - origin[1] + play.getHeight() / 2f;
            screen.setMenuBounds(new android.graphics.RectF[] { new android.graphics.RectF(x - 50, y - 50, x + 50, y + 50) });
            tap(screen, x, y);
            assertEquals("The menu receives taps over a native button", 1, web.downs);
            assertTrue(controls.isFullyVisible());
            screen.setMenuBounds(new android.graphics.RectF[0]);
            tap(screen, x, y);
            assertEquals("Closing the menu restores native button input", 1, web.downs);
        });
    }

    @Test public void inlineNativeControlsRemainVisibleAndReceiveTouches() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setControlsVisible(true);
            assertTrue("Inline playback must keep the native transport controls", controls.isFullyVisible());
            View play = controls.findViewById(androidx.media3.ui.R.id.exo_play_pause);
            int[] location = new int[2];
            int[] origin = new int[2];
            play.getLocationOnScreen(location);
            screen.getLocationOnScreen(origin);
            long now = SystemClock.uptimeMillis();
            MotionEvent event = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN,
                location[0] - origin[0] + play.getWidth() / 2f,
                location[1] - origin[1] + play.getHeight() / 2f, 0);
            try {
                assertTrue("Inline transport taps must reach native controls", screen.dispatchTouchEvent(event));
                event.setAction(MotionEvent.ACTION_UP);
                screen.dispatchTouchEvent(event);
                screen.setMenuBounds(new android.graphics.RectF[] { new android.graphics.RectF(0, 0, 1000, 600) });
                event.setAction(MotionEvent.ACTION_DOWN);
                assertTrue("Inline menu taps must reach the WebView above the native video", screen.dispatchTouchEvent(event));
                assertEquals(1, web.downs);
            } finally { event.recycle(); }
            screen.setInlineVisible(false);
            assertFalse("Offscreen players must not leave floating buttons", controls.isFullyVisible());
        });
    }

    @Test public void queueButtonsOnlyAppearForAvailableFullscreenActions() {
        withScreen((screen, controls, web, engine) -> {
            NativeQueuePlayer player = (NativeQueuePlayer) controls.getPlayer();
            screen.setFullscreen(true);
            View previous = controls.findViewById(androidx.media3.ui.R.id.exo_prev);
            View next = controls.findViewById(androidx.media3.ui.R.id.exo_next);
            assertEquals(View.GONE, previous.getVisibility());
            assertEquals(View.GONE, next.getVisibility());
            player.setActions(java.util.Collections.singleton(AndroidMediaActions.NEXT));
            assertEquals(View.GONE, previous.getVisibility());
            assertEquals(View.VISIBLE, next.getVisibility());
            player.setActions(java.util.Collections.singleton(AndroidMediaActions.PREVIOUS));
            assertEquals(View.VISIBLE, previous.getVisibility());
            assertEquals(View.GONE, next.getVisibility());
            screen.setFullscreen(false);
            assertEquals(View.GONE, previous.getVisibility());
            screen.setFullscreen(true);
            assertEquals(View.VISIBLE, previous.getVisibility());
            player.setActions(java.util.Collections.emptySet());
            assertEquals(View.GONE, previous.getVisibility());
            assertEquals(View.GONE, next.getVisibility());
        });
    }

    @Test public void verticalSwipesFromNativeButtonsReachSharedGesturesWithoutClicking() {
        withScreen((screen, controls, web, engine) -> {
            screen.setFullscreen(false);
            screen.setInlineVisible(true);
            screen.setControlsVisible(true);
            View play = controls.findViewById(androidx.media3.ui.R.id.exo_play_pause);
            int[] clicks = { 0 };
            int[] cancels = { 0 };
            play.setEnabled(true);
            play.setOnClickListener(view -> clicks[0]++);
            play.setOnTouchListener((view, event) -> {
                if (event.getActionMasked() == MotionEvent.ACTION_CANCEL) cancels[0]++;
                return false;
            });
            int[] location = new int[2];
            int[] origin = new int[2];
            play.getLocationOnScreen(location);
            screen.getLocationOnScreen(origin);
            float x = location[0] - origin[0] + play.getWidth() / 2f;
            float y = location[1] - origin[1] + play.getHeight() / 2f;
            long now = SystemClock.uptimeMillis();
            int[] actions = { MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP };
            for (int index = 0; index < actions.length; index++) {
                MotionEvent event = MotionEvent.obtain(now, now + index * 100, actions[index], x, y - (index == 0 ? 0 : 120), 0);
                screen.dispatchTouchEvent(event);
                event.recycle();
            }
            assertEquals("The native button must receive cancellation before handing off the swipe", 1, cancels[0]);
            assertEquals("Shared fullscreen gestures need the complete touch sequence", java.util.Arrays.asList(
                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP), web.actions);
            assertEquals("The swipe must not activate play/pause", 0, clicks[0]);
        });
    }

    private static void tap(NativePlaybackScreen screen, float x, float y) {
        long now = SystemClock.uptimeMillis();
        for (int action : new int[] {MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP}) {
            MotionEvent event = MotionEvent.obtain(now, now, action, x, y, 0);
            screen.dispatchTouchEvent(event);
            event.recycle();
        }
    }
}
