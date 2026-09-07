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
    private final SubtitleView subtitles;
    private final TextureView video;
    private Surface surface;
    private boolean backgroundGesture;
    private final WebView webOverlay;
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
            addView(webOverlay, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        } else {
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
        controls.bringToFront();
    }

    void setControlsVisible(boolean visible) {
        controlsVisible = visible;
        if (visible && (fullscreen || inlineVisible) && !pictureInPicture) controls.show(); else controls.hide();
    }

    void layoutControls(double x, double y, double width, double height, double viewportWidth) {
        if (viewportWidth <= 0 || width <= 0 || height <= 0) return;
        double scale = getWidth() / viewportWidth;
        LayoutParams layout = new LayoutParams((int) Math.round(width * scale), (int) Math.round(height * scale));
        layout.leftMargin = (int) Math.round(x * scale);
        layout.topMargin = (int) Math.round(y * scale);
        controls.setLayoutParams(layout);
    }

    void setMenuBounds(android.graphics.RectF[] bounds) {
        menuBounds = bounds;
        invalidate();
    }

    @Override protected boolean drawChild(android.graphics.Canvas canvas, View child, long drawingTime) {
        if (child != controls || menuBounds.length == 0) return super.drawChild(canvas, child, drawingTime);
        int save = canvas.save();
        for (android.graphics.RectF bounds : menuBounds) {
            if (android.os.Build.VERSION.SDK_INT >= 26) canvas.clipOutRect(bounds);
            else canvas.clipRect(bounds, android.graphics.Region.Op.DIFFERENCE);
        }
        boolean drawn = super.drawChild(canvas, child, drawingTime);
        canvas.restoreToCount(save);
        return drawn;
    }

    private boolean isOverMenu(float x, float y) {
        for (android.graphics.RectF bounds : menuBounds) if (bounds.contains(x, y)) return true;
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
        if (webOverlay != null && webOverlay.getParent() == this) {
            removeView(webOverlay);
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
        boolean nativeVideoVisible = fullscreen || pictureInPicture || inlineVisible;
        setBackgroundColor(Color.BLACK);
        videoFrame.setAlpha(nativeVideoVisible ? 1 : 0);
        setControlsVisible(controlsVisible);
        updateSubtitleVisibility();
        engine.setSurface(fullscreen || pictureInPicture || inlineVisible ? surface : null);
    }

    private void updateSubtitleVisibility() {
        // Text captions use Watch's shared displayer and appearance settings.
        // PiP has no WebView overlay; bitmap captions also need native drawing.
        subtitles.setVisibility(webOverlay == null || pictureInPicture || bitmapCaptions ? View.VISIBLE : View.GONE);
    }

    void setInlineVisible(boolean visible) {
        if (inlineVisible == visible) return;
        inlineVisible = visible;
        updatePresentation();
    }

    void layoutVideo(double x, double y, double width, double height, double viewportWidth) {
        videoBounds = new double[] { x, y, width, height, viewportWidth };
        if (pictureInPicture) {
            videoFrame.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER));
            return;
        }
        if (webOverlay == null || viewportWidth <= 0 || width <= 0 || height <= 0) return;
        double scale = getWidth() / viewportWidth;
        VideoSize size = engine.getPlayer().getVideoSize();
        double ratio = size.height > 0 ? size.width * size.pixelWidthHeightRatio / size.height : width / height;
        double fittedWidth = Math.min(width, height * ratio);
        double fittedHeight = Math.min(height, width / ratio);
        LayoutParams layout = new LayoutParams((int) Math.round(fittedWidth * scale), (int) Math.round(fittedHeight * scale));
        layout.leftMargin = (int) Math.round((x + (width - fittedWidth) / 2) * scale);
        layout.topMargin = (int) Math.round((y + (height - fittedHeight) / 2) * scale);
        videoFrame.setLayoutParams(layout);
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
        if (webOverlay != null) webOverlay.setAlpha(enabled ? 0 : 1);
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
            clearNativeButtonDown();
            gestureTarget = !isOverMenu(event.getX(), event.getY()) && controls.isFullyVisible() &&
                hasControlAt(controls, event.getRawX(), event.getRawY()) ? controls : webOverlay;
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
                gestureTarget = webOverlay;
                dispatchToTarget(webOverlay, nativeButtonDown);
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
    @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) {}
}
