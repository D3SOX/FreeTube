package org.opentubex.app;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.webkit.WebView;

import java.util.function.Consumer;

final class WebViewScreenshot {
    private WebViewScreenshot() {}

    static void capture(Activity activity, WebView webView, Consumer<Bitmap> success, Consumer<Exception> failure) {
        if (!webView.isAttachedToWindow() || webView.getWidth() <= 0 || webView.getHeight() <= 0) {
            failure.accept(new IllegalStateException("WebView is not ready for capture"));
            return;
        }
        int[] location = new int[2];
        webView.getLocationInWindow(location);
        Rect bounds = new Rect(location[0], location[1],
            location[0] + webView.getWidth(), location[1] + webView.getHeight());
        Bitmap bitmap = Bitmap.createBitmap(webView.getWidth(), webView.getHeight(), Bitmap.Config.ARGB_8888);
        try {
            // Software WebView.draw can scale individual compositor layers
            // differently on recent Chromium versions. Copy the rendered pixels.
            PixelCopy.request(activity.getWindow(), bounds, bitmap, result -> {
                if (result == PixelCopy.SUCCESS) {
                    success.accept(bitmap);
                } else {
                    bitmap.recycle();
                    failure.accept(new IllegalStateException("PixelCopy failed: " + result));
                }
            }, new Handler(Looper.getMainLooper()));
        } catch (IllegalArgumentException error) {
            bitmap.recycle();
            failure.accept(error);
        }
    }
}
