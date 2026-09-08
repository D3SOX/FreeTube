package org.opentubex.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.webkit.WebView;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.getcapacitor.JSObject;

/** Native gesture handling; the renderer decides which DOM targets can refresh. */
public class PullToRefreshLayout extends SwipeRefreshLayout {
    private WebView webView;
    private boolean configured;
    private boolean starting;
    private boolean allowed;
    private long gesture;
    private float startX;
    private float startY;
    private JSObject refreshContext;
    private OnRefreshListener refreshListener;

    public PullToRefreshLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
        setEnabled(false);
        setOnChildScrollUpCallback((parent, child) ->
            webView == null || webView.canScrollVertically(-1) || (!starting && !allowed));
    }

    public void configure(WebView view, boolean enabled) {
        webView = view;
        configured = enabled;
        gesture++;
        allowed = false;
        setEnabled(enabled);
        if (!enabled) setRefreshing(false);
    }

    public JSObject getRefreshContext() {
        return refreshContext;
    }

    @Override
    public void setOnRefreshListener(OnRefreshListener listener) {
        refreshListener = listener;
        super.setOnRefreshListener(listener);
    }

    /** Keep the original host in place for native playback's window/inset measurements. */
    PullToRefreshLayout wrapPlaybackOverlay(WebView view) {
        gesture++;
        allowed = false;
        refreshContext = null;
        setRefreshing(false);
        // The empty host no longer draws animation frames. Reset its indicator
        // immediately so it cannot reappear when the WebView returns.
        setEnabled(false);
        setEnabled(configured);
        PullToRefreshLayout overlay = new PullToRefreshLayout(getContext(), null);
        overlay.addView(view, new android.view.ViewGroup.LayoutParams(-1, -1));
        overlay.configure(view, configured);
        overlay.setOnRefreshListener(refreshListener);
        return overlay;
    }

    @Override
    public void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        // SwipeRefreshLayout caches its target after removal. The empty page host
        // must not measure a WebView now owned by the native playback overlay.
        if (webView != null && webView.getParent() != this) {
            setMeasuredDimension(getDefaultSize(getSuggestedMinimumWidth(), widthMeasureSpec),
                getDefaultSize(getSuggestedMinimumHeight(), heightMeasureSpec));
            return;
        }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);
    }

    @Override
    protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
        if (webView == null || webView.getParent() == this) {
            super.onLayout(changed, left, top, right, bottom);
        }
    }

    @Override
    protected void dispatchDraw(android.graphics.Canvas canvas) {
        // The indicator's cached drawing index also belongs to the old child list.
        if (webView == null || webView.getParent() == this) super.dispatchDraw(canvas);
    }

    @Override
    protected int getChildDrawingOrder(int childCount, int drawingPosition) {
        // Autofill also queries this order on the empty host, outside dispatchDraw.
        // AndroidX still caches the indicator's index from before WebView removal.
        if (webView != null && webView.getParent() != this) return drawingPosition;
        return super.getChildDrawingOrder(childCount, drawingPosition);
    }

    @Override
    protected boolean drawChild(android.graphics.Canvas canvas, android.view.View child, long drawingTime) {
        // Native playback draws the indicator last, above its separate video and controls.
        if (getParent() instanceof NativePlaybackScreen && child != webView) return false;
        return super.drawChild(canvas, child, drawingTime);
    }

    @Override
    public void onDescendantInvalidated(android.view.View child, android.view.View target) {
        super.onDescendantInvalidated(child, target);
        if (child != webView && getParent() instanceof NativePlaybackScreen) {
            // The indicator is recorded in the playback screen's display list,
            // so changes to it must invalidate that screen as well as this host.
            ((android.view.View) getParent()).invalidate();
        }
    }

    void drawRefreshIndicator(android.graphics.Canvas canvas, long drawingTime) {
        if (getVisibility() != VISIBLE || getAlpha() == 0) return;
        int save = canvas.save();
        canvas.translate(getLeft(), getTop());
        canvas.clipRect(0, 0, getWidth(), getHeight());
        // SwipeRefreshLayout owns one other child: its animated refresh indicator.
        for (int i = 0; i < getChildCount(); i++) {
            android.view.View child = getChildAt(i);
            if (child != webView && child.getVisibility() == VISIBLE) {
                // Moving the draw out of dispatchDraw also moves responsibility
                // for scheduling animation frames and their completion callbacks.
                if (super.drawChild(canvas, child, drawingTime)) {
                    ((android.view.View) getParent()).postInvalidateOnAnimation();
                }
            }
        }
        canvas.restoreToCount(save);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN && !isRefreshing()) {
            long currentGesture = ++gesture;
            allowed = false;
            refreshContext = null;
            startX = event.getX();
            startY = event.getY();
            setEnabled(configured);
            if (configured && webView != null && !webView.canScrollVertically(-1)) {
                // Normalized WebView coordinates also work with page zoom and density changes.
                double x = (event.getX() - webView.getLeft()) / Math.max(1, webView.getWidth());
                double y = (event.getY() - webView.getTop()) / Math.max(1, webView.getHeight());
                webView.evaluateJavascript(
                    "window.__opentubexPullToRefresh?.(" + x + "," + y + ") ?? null",
                    result -> {
                        if (currentGesture != gesture || !configured) return;
                        try {
                            JSObject context = new JSObject(result);
                            if (context.getString("tabId") == null) return;
                            refreshContext = context;
                            float density = getResources().getDisplayMetrics().density;
                            int offset = (int) (context.optDouble("offset", 0) * webView.getHeight());
                            setProgressViewOffset(false, offset, offset + (int) (64 * density));
                            applyColors(context);
                            allowed = true;
                        } catch (Exception ignored) {
                            // Missing renderer, rejected target, or navigation: leave scrolling alone.
                        }
                    }
                );
            }
        } else if (action == MotionEvent.ACTION_POINTER_DOWN ||
            (action == MotionEvent.ACTION_MOVE &&
                Math.abs(event.getX() - startX) > ViewConfiguration.get(getContext()).getScaledTouchSlop() &&
                Math.abs(event.getX() - startX) > Math.abs(event.getY() - startY))) {
            // A horizontal gesture or a second finger cancels the entire pull.
            gesture++;
            allowed = false;
            if (!isRefreshing()) setEnabled(false);
        }

        // Seed Android's gesture tracking on DOWN, but do not intercept moves until
        // the asynchronous DOM hit test has approved this particular gesture.
        starting = action == MotionEvent.ACTION_DOWN;
        boolean handled = super.dispatchTouchEvent(event);
        starting = false;
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            gesture++;
            // AndroidX does not finish or dismiss a drag on ACTION_CANCEL.
            // Reset it now; the next DOWN restores the configured enabled state.
            if (action == MotionEvent.ACTION_CANCEL && !isRefreshing()) setEnabled(false);
        }
        return handled;
    }

    private void applyColors(JSObject context) {
        try {
            setColorSchemeColors(parseColor(context.getString("color", "#000000")));
            setProgressBackgroundColorSchemeColor(parseColor(context.getString("backgroundColor", "#ffffff")));
        } catch (IllegalArgumentException ignored) {
            // A custom theme must not disable gesture recognition.
        }
    }

    private static int parseColor(String color) {
        if (color.matches("#[0-9a-fA-F]{3,4}")) {
            StringBuilder expanded = new StringBuilder("#");
            for (int i = 1; i < color.length(); i++) expanded.append(color.charAt(i)).append(color.charAt(i));
            color = expanded.toString();
        }
        if (color.isEmpty()) throw new IllegalArgumentException("Empty theme color");
        return com.getcapacitor.util.WebColor.parseColor(color);
    }
}
