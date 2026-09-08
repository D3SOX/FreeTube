package org.opentubex.app;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "AndroidMediaSession")
public class AndroidMediaSessionPlugin extends Plugin {
    private static WeakReference<AndroidMediaSessionPlugin> activePlugin = new WeakReference<>(null);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        activePlugin = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        if (activePlugin.get() == this) {
            activePlugin.clear();
            try {
                // Let pending foreground starts run and acknowledge before teardown.
                getContext().startService(new Intent(getContext(), AndroidMediaSessionService.class)
                    .setAction(AndroidMediaSessionService.ACTION_STOP));
            } catch (IllegalStateException | SecurityException error) {
                com.getcapacitor.Logger.error("Could not queue playback service shutdown", error);
            }
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void update(PluginCall call) {
        JSObject state = call.getObject("state");
        if (state == null) {
            call.reject("Media state is required");
            return;
        }

        mainHandler.post(() -> {
            if (activePlugin.get() != this || !AndroidPlaybackPlugin.acceptsMediaOwner(state.optString("nativeOwner", ""))) {
                call.resolve();
                return;
            }
            Intent intent = new Intent(getContext(), AndroidMediaSessionService.class)
                .setAction(AndroidMediaSessionService.ACTION_UPDATE)
                .putExtra(AndroidMediaSessionService.EXTRA_STATE, state.toString());
            try {
                ContextCompat.startForegroundService(getContext(), intent);
                call.resolve();
            } catch (IllegalStateException | SecurityException error) {
                call.reject("Android did not allow starting the playback service", error);
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        mainHandler.post(() -> {
            if (AndroidPlaybackPlugin.acceptsMediaOwner(call.getString("nativeOwner", ""))) {
                try {
                    // Deliver the stop after pending updates have acknowledged their
                    // foreground starts. stopService() can kill an unstarted service.
                    getContext().startService(new Intent(getContext(), AndroidMediaSessionService.class)
                        .setAction(AndroidMediaSessionService.ACTION_UPDATE)
                        .putExtra(AndroidMediaSessionService.EXTRA_STATE, new JSObject()
                            .put("nativeOwner", call.getString("nativeOwner", ""))
                            .put("playbackState", "none").toString()));
                } catch (IllegalStateException | SecurityException error) {
                    call.reject("Android did not allow clearing the playback service", error);
                    return;
                }
            }
            call.resolve();
        });
    }

    static void emitAction(String action) {
        emitAction(action, null, null);
    }

    static void emitAction(String action, Double seekTime, Double seekOffset) {
        if (!AndroidMediaActions.isSupported(action)) {
            return;
        }
        if (AndroidPlaybackPlugin.handleAction(action, seekTime, seekOffset)) return;

        AndroidMediaSessionPlugin plugin = activePlugin.get();
        if (plugin == null) {
            return;
        }

        JSObject event = new JSObject();
        event.put("action", action);
        if (seekTime != null) event.put("seekTime", seekTime);
        if (seekOffset != null) event.put("seekOffset", seekOffset);
        plugin.notifyListeners("action", event);
    }
}
