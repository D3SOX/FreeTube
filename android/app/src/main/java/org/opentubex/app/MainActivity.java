package org.opentubex.app;

import android.content.res.Configuration;
import android.hardware.input.InputManager;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    private InputManager inputManager;
    private final InputManager.InputDeviceListener inputDeviceListener =
        new InputManager.InputDeviceListener() {
            @Override
            public void onInputDeviceAdded(int deviceId) {
                notifyHardwareKeyboardState();
            }

            @Override
            public void onInputDeviceRemoved(int deviceId) {
                notifyHardwareKeyboardState();
            }

            @Override
            public void onInputDeviceChanged(int deviceId) {
                notifyHardwareKeyboardState();
            }
        };

    @Override
    public void onStart() {
        super.onStart();
        AppVisibility.setVisible(true);
    }

    @Override
    public void onStop() {
        AppVisibility.setVisible(false);
        super.onStop();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidProxyPlugin.class);
        registerPlugin(PoTokenPlugin.class);
        registerPlugin(YtDlpPlugin.class);
        registerPlugin(AndroidUiPlugin.class);
        registerPlugin(ScreenshotPlugin.class);
        registerPlugin(PullToRefreshPlugin.class);
        registerPlugin(AndroidStoragePlugin.class);
        registerPlugin(AndroidMediaSessionPlugin.class);
        registerPlugin(AndroidPlaybackPlugin.class);
        registerPlugin(SubscriptionRefreshPlugin.class);
        registerPlugin(UnifiedPushPlugin.class);
        registerPlugin(SabrHttpPlugin.class);
        registerPlugin(VoiceOverHttpPlugin.class);
        super.onCreate(savedInstanceState);
        // Honor viewport widths larger than the device for UI scales below 100%.
        getBridge().getWebView().getSettings().setUseWideViewPort(true);
        // Capacitor falls back to addJavascriptInterface when the modern,
        // top-frame-only bridge is unavailable. Fail closed instead of
        // exposing native plugins to untrusted subframes.
        getBridge().getWebView().removeJavascriptInterface("androidBridge");
        getBridge().setWebViewClient(new OpenTubeXWebViewClient(getBridge()));
        OpenTubeXNotificationChannels.createAll(this);
        inputManager = (InputManager) getSystemService(INPUT_SERVICE);
        inputManager.registerInputDeviceListener(inputDeviceListener, null);
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (AndroidPlaybackPlugin.handleBack()) return;
                // Capacitor App owns ordinary navigation and app dismissal.
                setEnabled(false);
                try {
                    getOnBackPressedDispatcher().onBackPressed();
                } finally {
                    setEnabled(true);
                }
            }
        });
    }

    @Override
    public void onDestroy() {
        inputManager.unregisterInputDeviceListener(inputDeviceListener);
        super.onDestroy();
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();

        PluginHandle handle = getBridge().getPlugin("AndroidUi");
        if (handle != null && handle.getInstance() instanceof AndroidUiPlugin) {
            ((AndroidUiPlugin) handle.getInstance()).enterAutomaticPictureInPictureIfEnabled();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(
        boolean isInPictureInPictureMode,
        Configuration newConfig
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        AndroidPlaybackPlugin.pictureInPictureChanged(isInPictureInPictureMode);
        getBridge().triggerWindowJSEvent(
            "opentubex:android-pip",
            "{\"active\":" + isInPictureInPictureMode + "}"
        );
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);

        notifyHardwareKeyboardState();
    }

    private void notifyHardwareKeyboardState() {
        PluginHandle handle = getBridge().getPlugin("AndroidUi");
        if (handle != null && handle.getInstance() instanceof AndroidUiPlugin) {
            boolean attached = ((AndroidUiPlugin) handle.getInstance()).hasHardwareKeyboard();
            getBridge().triggerWindowJSEvent(
                "opentubex:hardware-keyboard",
                "{\"attached\":" + attached + "}"
            );
        }
    }
}
