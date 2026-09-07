package org.opentubex.app;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "AndroidStorage")
public class AndroidStoragePlugin extends Plugin {
    @PluginMethod
    public void getUsage(PluginCall call) {
        AndroidStorage.Usage usage = getUsage(getContext());
        JSObject result = new JSObject();
        result.put("appDataBytes", usage.appDataBytes);
        result.put("cacheBytes", usage.cacheBytes);
        result.put("totalBytes", usage.totalBytes());
        call.resolve(result);
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        CountDownLatch webViewCacheCleared = new CountDownLatch(1);

        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().clearCache(true);
            webViewCacheCleared.countDown();
        });

        try {
            if (!webViewCacheCleared.await(5, TimeUnit.SECONDS)) {
                call.reject("Timed out while clearing the WebView cache");
                return;
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            call.reject("Interrupted while clearing the WebView cache", error);
            return;
        }

        boolean cleared = clearCacheFiles(getContext());

        JSObject result = new JSObject();
        result.put("cleared", cleared);
        call.resolve(result);
    }

    static AndroidStorage.Usage getUsage(Context context) {
        return AndroidStorage.measure(context.getDataDir(), cacheDirectories(context));
    }

    static boolean clearCacheFiles(Context context) {
        synchronized (YtDlpPlugin.PLAYBACK_CACHE_LOCK) {
            boolean cleared = true;
            for (File directory : cacheDirectories(context)) cleared &= AndroidStorage.clearDirectory(directory);
            return cleared;
        }
    }

    private static File[] cacheDirectories(Context context) {
        return new File[] {
            context.getCacheDir(),
            context.getCodeCacheDir(),
            YtDlpPlugin.playbackCacheDirectory(context)
        };
    }
}
