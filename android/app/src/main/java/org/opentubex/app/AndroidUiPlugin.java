package org.opentubex.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.input.InputManager;
import android.os.Build;
import android.util.Rational;
import android.view.InputDevice;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

@CapacitorPlugin(name = "AndroidUi")
public class AndroidUiPlugin extends Plugin {
    private boolean autoPictureInPictureEnabled = false;
    private Rational pictureInPictureAspectRatio = new Rational(16, 9);

    @PluginMethod
    public void takeScreenshot(PluginCall call) {
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

    @PluginMethod
    public void setSystemBarsBackground(PluginCall call) {
        final int color;
        try {
            color = com.getcapacitor.util.WebColor.parseColor(call.getString("color", "#000000"));
        } catch (IllegalArgumentException error) {
            call.reject("Invalid system bar background color", error);
            return;
        }
        getActivity().runOnUiThread(() -> {
            android.view.Window window = getActivity().getWindow();
            // Capacitor pads the WebView parent on older WebViews. Its native
            // inset background must follow the same theme as the shared UI.
            // SystemBars reapplies the OS theme background on style/rotation
            // changes. A tint preserves the app theme through those updates.
            window.getDecorView().setBackgroundTintList(android.content.res.ColorStateList.valueOf(color));
            window.getDecorView().setBackgroundColor(color);
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            call.resolve();
        });
    }

    @PluginMethod
    public void getPictureInPictureSupport(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", supportsPictureInPicture());
        result.put("automaticSupported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
        call.resolve(result);
    }

    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        updateAspectRatio(call);
        getActivity().runOnUiThread(() -> {
            if (!supportsPictureInPicture()) {
                call.reject("Picture-in-Picture is not supported on this device");
                return;
            }

            boolean entered = PictureInPicture.enter(
                getActivity(),
                pictureInPictureAspectRatio,
                false
            );
            if (entered) {
                call.resolve();
            } else {
                call.reject("Android rejected the Picture-in-Picture request");
            }
        });
    }

    @PluginMethod
    public void setAutoPictureInPicture(PluginCall call) {
        autoPictureInPictureEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        updateAspectRatio(call);
        getActivity().runOnUiThread(() -> {
            if (supportsPictureInPicture()) {
                PictureInPicture.configure(
                    getActivity(),
                    pictureInPictureAspectRatio,
                    autoPictureInPictureEnabled
                );
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.resolve();
            getActivity().finishAndRemoveTask();
        });
    }

    @PluginMethod
    public void getHardwareKeyboardState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("attached", hasHardwareKeyboard());
        call.resolve(result);
    }

    @PluginMethod
    public void getDeviceArchitecture(PluginCall call) {
        JSObject result = new JSObject();
        result.put(
            "architecture",
            Build.SUPPORTED_ABIS.length == 0 ? "" : Build.SUPPORTED_ABIS[0]
        );
        call.resolve(result);
    }

    public boolean hasHardwareKeyboard() {
        InputManager inputManager = (InputManager) getContext()
            .getSystemService(Context.INPUT_SERVICE);
        for (int deviceId : inputManager.getInputDeviceIds()) {
            InputDevice device = inputManager.getInputDevice(deviceId);
            if (isHardwareKeyboardDevice(device)) {
                return true;
            }
        }
        return false;
    }

    static boolean isHardwareKeyboardDevice(InputDevice device) {
        return device != null && isHardwareKeyboardDevice(
            device.isVirtual(),
            device.getKeyboardType()
        );
    }

    static boolean isHardwareKeyboardDevice(boolean virtual, int keyboardType) {
        return !virtual && keyboardType == InputDevice.KEYBOARD_TYPE_ALPHABETIC;
    }

    public void enterAutomaticPictureInPictureIfEnabled() {
        if (
            !autoPictureInPictureEnabled ||
            !supportsPictureInPicture() ||
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ||
            getActivity().isInPictureInPictureMode()
        ) {
            return;
        }

        PictureInPicture.enter(getActivity(), pictureInPictureAspectRatio, false);
    }

    private boolean supportsPictureInPicture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private void updateAspectRatio(PluginCall call) {
        int width = Math.max(1, call.getInt("width", 16));
        int height = Math.max(1, call.getInt("height", 9));
        double ratio = (double) width / height;

        // Android only accepts PiP aspect ratios between 1:2.39 and 2.39:1.
        if (ratio >= (1.0 / 2.39) && ratio <= 2.39) {
            pictureInPictureAspectRatio = new Rational(width, height);
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private static final class PictureInPicture {
        private PictureInPicture() {}

        static boolean enter(Activity activity, Rational aspectRatio, boolean automatic) {
            return activity.enterPictureInPictureMode(buildParams(aspectRatio, automatic));
        }

        static void configure(Activity activity, Rational aspectRatio, boolean automatic) {
            activity.setPictureInPictureParams(buildParams(aspectRatio, automatic));
        }

        private static PictureInPictureParams buildParams(
            Rational aspectRatio,
            boolean automatic
        ) {
            PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
                .setAspectRatio(aspectRatio);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setAutoEnterEnabled(automatic);
                builder.setSeamlessResizeEnabled(true);
            }

            return builder.build();
        }
    }
}
