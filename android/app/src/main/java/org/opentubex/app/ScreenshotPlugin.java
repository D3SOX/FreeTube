package org.opentubex.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

@CapacitorPlugin(name = "Screenshot")
public class ScreenshotPlugin extends Plugin {
    @PluginMethod
    public void take(PluginCall call) {
        getActivity().runOnUiThread(() -> WebViewScreenshot.capture(
            getActivity(), getBridge().getWebView(),
            bitmap -> getBridge().execute(() -> {
                File screenshot = null;
                try {
                    screenshot = File.createTempFile("tab-preview-", ".jpg", getContext().getCacheDir());
                    try (FileOutputStream output = new FileOutputStream(screenshot)) {
                        if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, output)) {
                            throw new IOException("Could not encode screenshot");
                        }
                    }
                    JSObject result = new JSObject();
                    result.put("uri", screenshot.getAbsolutePath());
                    call.resolve(result);
                } catch (Exception error) {
                    if (screenshot != null) screenshot.delete();
                    call.reject("Could not save screenshot", error);
                } finally {
                    bitmap.recycle();
                }
            }),
            error -> call.reject("Could not capture screenshot", error)
        ));
    }
}
