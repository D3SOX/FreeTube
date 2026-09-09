package org.opentubex.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.webkit.WebView;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerControlView;
import androidx.media3.ui.SubtitleView;
import androidx.media3.common.text.Cue;

import java.util.function.Consumer;

/** A native video surface whose destruction never destroys the playback pipeline. */
final class NativePlaybackScreen extends FrameLayout implements TextureView.SurfaceTextureListener {
    private final NativePlaybackEngine engine;
    private final AspectRatioFrameLayout videoFrame;
    private final PlayerControlView controls;
    private android.graphics.RectF[] menuBounds = new android.graphics.RectF[0];
    private android.graphics.RectF[] scrollingMenuBounds = new android.graphics.RectF[0];
    private final SubtitleView subtitles;
    private final TextureView video;
    private Surface surface;
    private boolean backgroundGesture;
    private final WebView webOverlay;
    private final View webOverlayHost;
    private final ViewGroup originalParent;
    private final ViewGroup.LayoutParams originalLayout;
    private final int originalIndex;
    private final Consumer<String> action;
    private final View.OnLayoutChangeListener originalParentLayout = (view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> post(this::syncWindowBounds);
    private View gestureTarget;
    private MotionEvent nativeButtonDown;
    private boolean webOverlayActive;
    private boolean pictureInPicture;
    private boolean fullscreen = true;
    private boolean inlineVisible;
    private boolean bitmapCaptions;
    private boolean controlsVisible = true;
    private double[] videoBounds;
    private double[] controlsBounds;
    private boolean followsPageScroll;
    private android.animation.ValueAnimator videoAnimation;
    private boolean transitioning;
    private boolean miniPlayer;
    private float miniRadius;
    private boolean scrollingPage;
    private boolean scrollEndRequested;
    private boolean pageTouchDown;
    private float pageTouchY;
    private long lastPageScroll;
    private int lastWebScrollY;
    private final Runnable pageScrollSettled = this::requestPageScrollEnd;
    private final android.view.ViewTreeObserver.OnScrollChangedListener pageScrollListener = this::onPageScroll;
    private long transitionSequence;
    private long readyWebFrame = -1;
    private final java.util.Set<Runnable> pendingWebFrames = new java.util.HashSet<>();
    private final java.util.List<Runnable> afterWebDraw = new java.util.ArrayList<>();
    private final android.graphics.RectF transitionBounds = new android.graphics.RectF();
    private float transitionRadius;
    private final Player.Listener queueListener = new Player.Listener() {
        @Override public void onAvailableCommandsChanged(Player.Commands commands) {
            updateQueueButtons();
        }
    };
    private final Player.Listener listener = new Player.Listener() {
        @Override public void onVideoSizeChanged(VideoSize size) {
            updateAspectRatio(size);
        }

    };

    private final Consumer<java.util.List<Cue>> captionListener = this::updateCaptions;

    private void updateCaptions(java.util.List<Cue> cues) {
        subtitles.setCues(cues);
        bitmapCaptions = cues.stream().anyMatch(cue -> cue.bitmap != null);
        updateSubtitleVisibility();
    }

    NativePlaybackScreen(Activity activity, NativePlaybackEngine engine, WebView overlay,
        String locale, Consumer<String> action) {
        super(activity);
        this.engine = engine;
        this.action = action;
        webOverlay = overlay;
        setBackgroundColor(Color.BLACK);
        videoFrame = new AspectRatioFrameLayout(activity);
        videoFrame.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        addView(videoFrame, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER));
        video = new TextureView(activity);
        video.setSurfaceTextureListener(this);
        videoFrame.addView(video, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        subtitles = new SubtitleView(activity);
        subtitles.setUserDefaultStyle();
        subtitles.setUserDefaultTextSize();
        subtitles.setCues(engine.getCaptionCues());
        videoFrame.addView(subtitles, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        android.content.res.Configuration configuration = new android.content.res.Configuration(getResources().getConfiguration());
        if (locale != null && !locale.isEmpty()) configuration.setLocale(java.util.Locale.forLanguageTag(locale));
        controls = new PlayerControlView(activity.createConfigurationContext(configuration));
        ViewGroup centerControls = controls.findViewById(androidx.media3.ui.R.id.exo_center_controls);
        for (int index = 0; index < centerControls.getChildCount(); index++) {
            View button = centerControls.getChildAt(index);
            android.graphics.drawable.Drawable shadow = activity.getDrawable(R.drawable.native_player_control_shadow);
            android.graphics.drawable.Drawable background = button.getBackground();
            button.setBackground(background == null ? shadow : new android.graphics.drawable.LayerDrawable(
                new android.graphics.drawable.Drawable[] { shadow, background }));
        }
        if (webOverlay != null) {
            // Watch owns tap gestures and the visibility timer for both layers.
            controls.setShowTimeoutMs(0);
            controls.setAnimationEnabled(false);
            controls.findViewById(androidx.media3.ui.R.id.exo_controls_background).setBackgroundColor(Color.TRANSPARENT);
            // Watch's timeline includes chapters, SponsorBlock and A-B handles.
            // Media3 keeps its TimeBar reference for clock updates, but the
            // shared timeline owns drawing and input in this screen.
            View timeBar = controls.findViewById(androidx.media3.ui.R.id.exo_progress);
            ((ViewGroup) timeBar.getParent()).removeView(timeBar);
        }
        controls.setPlayer(engine.getControlsPlayer());
        engine.getControlsPlayer().addListener(queueListener);
        updateQueueButtons();
        if (webOverlay != null) {
            // Watch's toolbar owns timestamps, captions, PiP, quick speeds and
            // settings. Remove both native footer variants to avoid duplicates.
            for (int id : new int[] { androidx.media3.ui.R.id.exo_bottom_bar, androidx.media3.ui.R.id.exo_minimal_controls }) {
                View footer = controls.findViewById(id);
                ((ViewGroup) footer.getParent()).removeView(footer);
            }
        }
        controls.setOnFullScreenModeChangedListener(enabled -> { if (!enabled) action.accept("close"); });
        controls.updateIsFullscreen(true);
        addView(controls, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        if (webOverlay != null) {
            originalParent = (ViewGroup) webOverlay.getParent();
            originalIndex = originalParent.indexOfChild(webOverlay);
            originalLayout = webOverlay.getLayoutParams();
            originalParent.addOnLayoutChangeListener(originalParentLayout);
            originalParent.removeView(webOverlay);
            webOverlay.setBackgroundColor(Color.TRANSPARENT);
            webOverlay.getViewTreeObserver().addOnScrollChangedListener(pageScrollListener);
            webOverlayHost = originalParent instanceof PullToRefreshLayout
                ? ((PullToRefreshLayout) originalParent).wrapPlaybackOverlay(webOverlay)
                : webOverlay;
            addView(webOverlayHost, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        } else {
            webOverlayHost = null;
            originalParent = null;
            originalLayout = null;
            originalIndex = 0;
        }
        setOnClickListener(view -> {
            if (controls.isFullyVisible()) controls.hide(); else controls.show();
        });
        ViewCompat.setOnApplyWindowInsetsListener(this, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            controls.setPadding(fullscreen ? bars.left : 0, fullscreen ? bars.top : 0,
                fullscreen ? bars.right : 0, fullscreen ? bars.bottom : 0);
            return insets;
        });
        engine.getPlayer().addListener(listener);
        engine.addCaptionListener(captionListener);
        updateAspectRatio(engine.getPlayer().getVideoSize());
    }

    void setWebOverlayActive(boolean active) {
        webOverlayActive = active;
        // The controller has no full-screen scrim over the shared UI. Keep its
        // buttons above Watch's ambient canvas and route all empty space to WebView.
        if (!transitioning) controls.bringToFront();
    }

    void setControlsVisible(boolean visible) {
        controlsVisible = visible;
        if (visible && (fullscreen || inlineVisible) && !pictureInPicture && !transitioning) controls.show(); else controls.hide();
    }

    void layoutControls(double x, double y, double width, double height, double viewportWidth) {
        if (viewportWidth <= 0 || width <= 0 || height <= 0) return;
        controlsBounds = new double[] { x, y, width, height, viewportWidth };
        double scale = getWidth() / viewportWidth;
        int nativeWidth = (int) Math.round(width * scale);
        int nativeHeight = (int) Math.round(height * scale);
        LayoutParams current = (LayoutParams) controls.getLayoutParams();
        if (current.width != nativeWidth || current.height != nativeHeight || current.gravity != (Gravity.TOP | Gravity.LEFT)) {
            controls.setLayoutParams(new LayoutParams(nativeWidth, nativeHeight, Gravity.TOP | Gravity.LEFT));
        }
        controls.setTranslationX((float) (x * scale));
        controls.setTranslationY((float) ((y + pageScrollDelta(viewportWidth)) * scale));
    }

    private double pageScrollDelta(double viewportWidth) {
        return followsPageScroll && webOverlay != null && !fullscreen && !miniPlayer && !pictureInPicture && getWidth() > 0
            ? -webOverlay.getScrollY() * viewportWidth / getWidth() : 0;
    }

    void setScrollingMenuBounds(android.graphics.RectF[] bounds) {
        scrollingMenuBounds = bounds;
        invalidate();
    }

    private float menuScrollDelta() {
        return webOverlay == null ? 0 : -webOverlay.getScrollY();
    }

    private void clipMenus(android.graphics.Canvas canvas) {
        for (android.graphics.RectF bounds : menuBounds) canvas.clipOutRect(bounds);
        float delta = menuScrollDelta();
        for (android.graphics.RectF bounds : scrollingMenuBounds) {
            canvas.clipOutRect(bounds.left, bounds.top + delta, bounds.right, bounds.bottom + delta);
        }
    }

    void setMenuBounds(android.graphics.RectF[] bounds) {
        menuBounds = bounds;
        invalidate();
    }

    void afterWebFrame(Runnable action) {
        if (webOverlay == null) { action.run(); return; }
        pendingWebFrames.add(action);
        webOverlay.postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) {
                if (!pendingWebFrames.contains(action)) return;
                afterWebDraw.add(() -> { if (pendingWebFrames.remove(action)) action.run(); });
                webOverlay.invalidate();
                invalidate();
            }
        });
    }

    @Override protected void dispatchDraw(android.graphics.Canvas canvas) {
        super.dispatchDraw(canvas);
        if (!pictureInPicture && webOverlayHost instanceof PullToRefreshLayout) {
            ((PullToRefreshLayout) webOverlayHost).drawRefreshIndicator(canvas, getDrawingTime());
        }
    }

    @Override protected boolean drawChild(android.graphics.Canvas canvas, View child, long drawingTime) {
        if (child == webOverlayHost && readyWebFrame == transitionSequence) {
            long sequence = readyWebFrame;
            readyWebFrame = -1;
            // This draw consumes Chromium's ready frame. Keep the video above
            // it for this frame, then hand it back on the following vsync.
            postOnAnimation(() -> {
                if (transitionSequence != sequence) return;
                transitioning = false;
                webOverlayHost.bringToFront();
                controls.bringToFront();
                refreshVideoLayout();
                updatePresentation();
            });
        }
        if (child == webOverlayHost) {
            boolean drawn = super.drawChild(canvas, child, drawingTime);
            if (!afterWebDraw.isEmpty()) {
                java.util.List<Runnable> callbacks = new java.util.ArrayList<>(afterWebDraw);
                afterWebDraw.clear();
                postOnAnimation(() -> { for (Runnable callback : callbacks) callback.run(); });
            }
            return drawn;
        }
        if (child == videoFrame && transitioning && !pictureInPicture) {
            int save = canvas.save();
            clipMenus(canvas);
            android.graphics.Path clip = new android.graphics.Path();
            clip.addRoundRect(transitionBounds, transitionRadius, transitionRadius, android.graphics.Path.Direction.CW);
            canvas.clipPath(clip);
            canvas.drawColor(Color.BLACK);
            boolean drawn = super.drawChild(canvas, child, drawingTime);
            canvas.restoreToCount(save);
            return drawn;
        }
        if (child != controls || (menuBounds.length == 0 && scrollingMenuBounds.length == 0)) return super.drawChild(canvas, child, drawingTime);
        int save = canvas.save();
        clipMenus(canvas);
        boolean drawn = super.drawChild(canvas, child, drawingTime);
        canvas.restoreToCount(save);
        return drawn;
    }

    boolean isOverMenu(float x, float y) {
        for (android.graphics.RectF bounds : menuBounds) if (bounds.contains(x, y)) return true;
        float delta = menuScrollDelta();
        for (android.graphics.RectF bounds : scrollingMenuBounds) if (bounds.contains(x, y - delta)) return true;
        return false;
    }

    void back() {
        action.accept(webOverlayActive ? "back" : "close");
    }

    boolean isFullscreen() { return fullscreen; }

    void setFullscreen(boolean enabled) {
        fullscreen = enabled;
        controls.updateIsFullscreen(enabled);
        // Inline phone players reserve their center row for play and seeking.
        updateQueueButtons();
        if (!enabled) controls.setPadding(0, 0, 0, 0);
        ViewCompat.requestApplyInsets(this);
        updatePresentation();
        setWebOverlayActive(webOverlayActive);
    }

    private void syncWindowBounds() {
        if (!(getParent() instanceof View) || originalParent == null) return;
        LayoutParams layout;
        if (fullscreen || pictureInPicture) {
            layout = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
        } else {
            if (originalParent.getWidth() == 0 || originalParent.getHeight() == 0) return;
            // Older Android/WebView versions inset the original view's parent
            // instead of exposing safe-area CSS variables. Retain that viewport
            // while inline so the header and touch coordinates avoid system bars.
            int[] originalOrigin = new int[2];
            int[] parentOrigin = new int[2];
            originalParent.getLocationOnScreen(originalOrigin);
            ((View) getParent()).getLocationOnScreen(parentOrigin);
            layout = new LayoutParams(
                originalParent.getWidth() - originalParent.getPaddingLeft() - originalParent.getPaddingRight(),
                originalParent.getHeight() - originalParent.getPaddingTop() - originalParent.getPaddingBottom());
            layout.leftMargin = originalOrigin[0] - parentOrigin[0] + originalParent.getPaddingLeft();
            layout.topMargin = originalOrigin[1] - parentOrigin[1] + originalParent.getPaddingTop();
        }
        layout.gravity = Gravity.TOP | Gravity.LEFT;
        ViewGroup.LayoutParams current = getLayoutParams();
        if (current instanceof LayoutParams) {
            LayoutParams previous = (LayoutParams) current;
            if (previous.width == layout.width && previous.height == layout.height &&
                previous.leftMargin == layout.leftMargin && previous.topMargin == layout.topMargin && previous.gravity == layout.gravity) return;
        }
        setLayoutParams(layout);
    }

    private void restoreWebView() {
        if (webOverlayHost != null && webOverlayHost.getParent() == this) {
            removeView(webOverlayHost);
            if (webOverlayHost != webOverlay) ((ViewGroup) webOverlayHost).removeView(webOverlay);
            originalParent.addView(webOverlay, Math.min(originalIndex, originalParent.getChildCount()), originalLayout);
        }
    }

    private void updateQueueButtons() {
        Player player = engine.getControlsPlayer();
        controls.setShowPreviousButton(fullscreen && player.isCommandAvailable(Player.COMMAND_SEEK_TO_PREVIOUS));
        controls.setShowNextButton(fullscreen && player.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT));
    }

    private void updatePresentation() {
        syncWindowBounds();
        boolean nativeVideoVisible = fullscreen || pictureInPicture || inlineVisible || transitioning;
        setBackgroundColor(Color.BLACK);
        videoFrame.setAlpha(nativeVideoVisible ? 1 : 0);
        setControlsVisible(controlsVisible);
        updateSubtitleVisibility();
        engine.setSurface(nativeVideoVisible ? surface : null);
    }

    private void updateSubtitleVisibility() {
        // Text captions use Watch's shared displayer and appearance settings.
        // PiP has no WebView overlay; bitmap captions also need native drawing.
        subtitles.setVisibility(webOverlay == null || pictureInPicture || bitmapCaptions || transitioning ? View.VISIBLE : View.GONE);
    }

    void setFollowsPageScroll(boolean enabled) {
        followsPageScroll = enabled;
    }

    void setMiniPlayer(boolean enabled, float radius) {
        miniPlayer = enabled;
        miniRadius = radius;
        if (!enabled && scrollingPage) {
            scrollingPage = false;
            pageTouchDown = false;
            removeCallbacks(pageScrollSettled);
            action.accept("scroll-end");
            finishVideoTransition();
        }
    }

    private void onPageScroll() {
        if (webOverlay != null && lastWebScrollY != webOverlay.getScrollY()) {
            lastWebScrollY = webOverlay.getScrollY();
            if (followsPageScroll && !miniPlayer) {
                // Chromium reports its native scroll before a renderer bridge
                // layout arrives. Keep both native layers on that same frame.
                refreshVideoLayout();
                if (controlsBounds != null) layoutControls(controlsBounds[0], controlsBounds[1], controlsBounds[2], controlsBounds[3], controlsBounds[4]);
            }
            beginPageScroll();
        }
    }

    private void beginPageScroll() {
        if (!miniPlayer || fullscreen || pictureInPicture || !inlineVisible || videoBounds == null) return;
        lastPageScroll = android.os.SystemClock.uptimeMillis();
        removeCallbacks(pageScrollSettled);
        postDelayed(pageScrollSettled, 150);
        transitionSequence++;
        boolean notify = !scrollingPage || scrollEndRequested;
        scrollEndRequested = false;
        if (notify) action.accept("scroll-start");
        if (scrollingPage) return;
        scrollingPage = true;
        transitioning = true;
        if (videoAnimation == null) updateScrollBounds();
        videoFrame.bringToFront();
        updatePresentation();
    }

    private void updateScrollBounds() {
        double scale = getWidth() / videoBounds[4];
        transitionBounds.set((float) (videoBounds[0] * scale), (float) (videoBounds[1] * scale),
            (float) ((videoBounds[0] + videoBounds[2]) * scale), (float) ((videoBounds[1] + videoBounds[3]) * scale));
        transitionRadius = miniRadius * (float) scale;
    }

    private void requestPageScrollEnd() {
        if (scrollingPage && !pageTouchDown) {
            scrollEndRequested = true;
            action.accept("scroll-end");
        }
    }

    void finishPageScroll() {
        // A newer touch/fling may have started while the WebView acknowledged
        // the settled geometry. Keep the video raised until that scroll ends.
        if (!scrollingPage || pageTouchDown || android.os.SystemClock.uptimeMillis() - lastPageScroll < 150) return;
        scrollingPage = false;
        finishVideoTransition();
    }

    void setInlineVisible(boolean visible) {
        if (inlineVisible == visible) return;
        inlineVisible = visible;
        updatePresentation();
    }

    void layoutVideo(double x, double y, double width, double height, double viewportWidth) {
        videoBounds = new double[] { x, y, width, height, viewportWidth };
        if (transitioning && !pictureInPicture && !(scrollingPage && videoAnimation == null)) return;
        positionVideo(x, y + pageScrollDelta(viewportWidth), width, height, viewportWidth);
        if (scrollingPage && videoAnimation == null) updateScrollBounds();
    }

    private void positionVideo(double x, double y, double width, double height, double viewportWidth) {
        if (pictureInPicture) {
            videoFrame.setTranslationX(0);
            videoFrame.setTranslationY(0);
            videoFrame.setScaleX(1);
            videoFrame.setScaleY(1);
            videoFrame.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER));
            return;
        }
        if (webOverlay == null || viewportWidth <= 0 || width <= 0 || height <= 0 || getWidth() <= 0) return;
        double scale = getWidth() / viewportWidth;
        VideoSize size = engine.getPlayer().getVideoSize();
        double ratio = size.height > 0 ? size.width * size.pixelWidthHeightRatio / size.height : width / height;
        double fittedWidth = Math.min(width, height * ratio);
        double fittedHeight = Math.min(height, width / ratio);
        // Keep the decoder's TextureView at a stable size. Resizing it for each
        // animation frame reallocates its buffers, including during paused video.
        int textureWidth = getWidth();
        int textureHeight = (int) Math.round(textureWidth / ratio);
        LayoutParams current = (LayoutParams) videoFrame.getLayoutParams();
        if (current.width != textureWidth || current.height != textureHeight || current.gravity != (Gravity.TOP | Gravity.LEFT)) {
            videoFrame.setLayoutParams(new LayoutParams(textureWidth, textureHeight, Gravity.TOP | Gravity.LEFT));
        }
        videoFrame.setPivotX(0);
        videoFrame.setPivotY(0);
        videoFrame.setTranslationX((float) ((x + (width - fittedWidth) / 2) * scale));
        videoFrame.setTranslationY((float) ((y + (height - fittedHeight) / 2) * scale));
        videoFrame.setScaleX((float) (fittedWidth * scale / textureWidth));
        videoFrame.setScaleY((float) (fittedHeight * scale / textureHeight));
    }

    void animateVideo(double[] from, double[] to, long duration, float radius, Runnable finished) {
        followsPageScroll = false;
        double scale = getWidth() / to[4];
        // A reversal starts where the native frame is actually being drawn,
        // even though the shared DOM already has the previous destination.
        double[] origin = transitioning && scale > 0
            ? new double[] { transitionBounds.left / scale, transitionBounds.top / scale, transitionBounds.width() / scale, transitionBounds.height() / scale }
            : from;
        transitionSequence++;
        if (videoAnimation != null) videoAnimation.cancel();
        videoBounds = to;
        transitioning = true;
        videoFrame.bringToFront();
        updatePresentation();
        android.animation.ValueAnimator animation = android.animation.ValueAnimator.ofFloat(0, 1);
        videoAnimation = animation;
        animation.setDuration(duration);
        animation.setInterpolator(new android.view.animation.PathInterpolator(0.4f, 0, 0.2f, 1));
        animation.addUpdateListener(value -> {
            float progress = (float) value.getAnimatedValue();
            double x = origin[0] + (to[0] - origin[0]) * progress;
            double y = origin[1] + (to[1] - origin[1]) * progress;
            double width = origin[2] + (to[2] - origin[2]) * progress;
            double height = origin[3] + (to[3] - origin[3]) * progress;
            double frameScale = getWidth() / to[4];
            transitionRadius = radius * (float) frameScale;
            transitionBounds.set((float) (x * frameScale), (float) (y * frameScale), (float) ((x + width) * frameScale), (float) ((y + height) * frameScale));
            positionVideo(x, y, width, height, to[4]);
            invalidate();
        });
        animation.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator animator) {
                if (videoAnimation == animation) videoAnimation = null;
                finished.run();
            }
        });
        animation.start();
    }

    void finishVideoTransition() {
        if (scrollingPage) return;
        long sequence = ++transitionSequence;
        if (videoAnimation != null) videoAnimation.cancel();
        // Wait for the WebView's destination clip and controls to be committed
        // before lowering the video underneath them. A bridge reply alone does
        // not mean that Chromium has painted the requested DOM changes.
        if (webOverlay != null) webOverlay.postVisualStateCallback(sequence, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) {
                if (transitionSequence != requestId) return;
                readyWebFrame = requestId;
                invalidate();
                webOverlay.invalidate();
            }
        });
    }

    private void updateAspectRatio(VideoSize size) {
        if (size.width > 0 && size.height > 0) {
            videoFrame.setAspectRatio(size.width * size.pixelWidthHeightRatio / size.height);
            refreshVideoLayout();
        }
    }

    void setPictureInPicture(boolean enabled) {
        pictureInPicture = enabled;
        updatePresentation();
        if (webOverlayHost != null) webOverlayHost.setAlpha(enabled ? 0 : 1);
        refreshVideoLayout();
    }

    private void refreshVideoLayout() {
        if (videoBounds != null) layoutVideo(videoBounds[0], videoBounds[1], videoBounds[2], videoBounds[3], videoBounds[4]);
    }

    android.graphics.Bitmap captureFrame(int width, int height) {
        return video.isAvailable() ? video.getBitmap(width, height) : null;
    }

    @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        refreshVideoLayout();
    }

    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
            double scale = videoBounds == null ? 0 : getWidth() / videoBounds[4];
            boolean overVideo = videoBounds != null && event.getX() >= videoBounds[0] * scale &&
                event.getX() <= (videoBounds[0] + videoBounds[2]) * scale && event.getY() >= videoBounds[1] * scale &&
                event.getY() <= (videoBounds[1] + videoBounds[3]) * scale;
            pageTouchDown = miniPlayer && !overVideo && !isOverMenu(event.getX(), event.getY());
            pageTouchY = event.getY();
        } else if (event.getActionMasked() == MotionEvent.ACTION_MOVE && pageTouchDown &&
            Math.abs(event.getY() - pageTouchY) > android.view.ViewConfiguration.get(getContext()).getScaledTouchSlop()) {
            // Raise before forwarding the first scroll movement to Chromium.
            // Its compositor can scroll the page before JS repaints the clip.
            beginPageScroll();
        } else if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
            pageTouchDown = false;
            if (scrollingPage) {
                removeCallbacks(pageScrollSettled);
                postDelayed(pageScrollSettled, 150);
            }
        }
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
            clearNativeButtonDown();
            gestureTarget = !isOverMenu(event.getX(), event.getY()) && controls.isFullyVisible() &&
                hasControlAt(controls, event.getRawX(), event.getRawY()) ? controls : webOverlayHost;
            backgroundGesture = gestureTarget == null;
            if (gestureTarget == controls && webOverlay != null) nativeButtonDown = MotionEvent.obtain(event);
        }
        if (event.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN) clearNativeButtonDown();
        if (nativeButtonDown != null && event.getActionMasked() == MotionEvent.ACTION_MOVE) {
            float dx = event.getX() - nativeButtonDown.getX();
            float dy = event.getY() - nativeButtonDown.getY();
            if (Math.abs(dy) > android.view.ViewConfiguration.get(getContext()).getScaledTouchSlop() && Math.abs(dy) > Math.abs(dx)) {
                // Let Watch decide whether this is an enabled fullscreen swipe.
                // Cancel the button first, then replay the complete gesture so
                // the shared thresholds, animation and click suppression apply.
                MotionEvent cancel = MotionEvent.obtain(event);
                cancel.setAction(MotionEvent.ACTION_CANCEL);
                dispatchToTarget(controls, cancel);
                cancel.recycle();
                gestureTarget = webOverlayHost;
                dispatchToTarget(webOverlayHost, nativeButtonDown);
                clearNativeButtonDown();
            }
        }
        if (gestureTarget != null) {
            if (gestureTarget == controls && (event.getActionMasked() == MotionEvent.ACTION_DOWN ||
                event.getActionMasked() == MotionEvent.ACTION_UP)) action.accept("controls");
            boolean handled = dispatchToTarget(gestureTarget, event);
            if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) clearNativeButtonDown();
            return handled;
        }
        if (backgroundGesture) {
            if (event.getActionMasked() == MotionEvent.ACTION_UP) performClick();
            return true;
        }
        return super.dispatchTouchEvent(event);
    }

    private boolean dispatchToTarget(View target, MotionEvent event) {
        int[] origin = new int[2];
        int[] destination = new int[2];
        getLocationOnScreen(origin);
        target.getLocationOnScreen(destination);
        MotionEvent translated = MotionEvent.obtain(event);
        translated.offsetLocation(origin[0] - destination[0], origin[1] - destination[1]);
        boolean handled = target.dispatchTouchEvent(translated);
        translated.recycle();
        return handled;
    }

    private void clearNativeButtonDown() {
        if (nativeButtonDown == null) return;
        nativeButtonDown.recycle();
        nativeButtonDown = null;
    }

    private static boolean hasControlAt(View view, float x, float y) {
        if (!view.isShown() || view.getAlpha() == 0) return false;
        android.graphics.Rect bounds = new android.graphics.Rect();
        if (!view.getGlobalVisibleRect(bounds) || !bounds.contains((int) x, (int) y)) return false;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = group.getChildCount() - 1; index >= 0; index--) {
                if (hasControlAt(group.getChildAt(index), x, y)) return true;
            }
        }
        // The full-screen controller itself consumes background touches without
        // toggling visibility. Route those taps to the screen's click handler.
        return !(view instanceof ViewGroup) && (view.isClickable() || view instanceof androidx.media3.ui.TimeBar);
    }

    void close() {
        for (Runnable callback : new java.util.ArrayList<>(pendingWebFrames)) callback.run();
        pendingWebFrames.clear();
        afterWebDraw.clear();
        transitionSequence++;
        removeCallbacks(pageScrollSettled);
        if (webOverlay != null) webOverlay.getViewTreeObserver().removeOnScrollChangedListener(pageScrollListener);
        if (videoAnimation != null) videoAnimation.cancel();
        clearNativeButtonDown();
        engine.getControlsPlayer().removeListener(queueListener);
        controls.setPlayer(null);
        engine.getPlayer().removeListener(listener);
        engine.removeCaptionListener(captionListener);
        engine.setSurface(null);
        if (webOverlay != null) {
            originalParent.removeOnLayoutChangeListener(originalParentLayout);
            webOverlay.setAlpha(1);
            restoreWebView();
        }
        if (getParent() instanceof ViewGroup) ((ViewGroup) getParent()).removeView(this);
    }

    @Override public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) {
        surface = new Surface(texture);
        engine.setSurface(fullscreen || pictureInPicture || inlineVisible ? surface : null);
    }

    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
        engine.setSurface(null);
        if (surface != null) surface.release();
        surface = null;
        return true;
    }

    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) {}
    @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) {
        engine.onVideoFramePresented();
    }
}
