package org.opentubex.app;

import static org.junit.Assert.*;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

import androidx.core.content.ContextCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.lang.ref.WeakReference;
import java.util.Arrays;

@RunWith(AndroidJUnit4.class)
public class AndroidMediaSessionLifecycleTest {
    @Test public void unchangedStateRestoresForegroundAfterServiceDemotion() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent update = new Intent(context, AndroidMediaSessionService.class)
            .setAction(AndroidMediaSessionService.ACTION_UPDATE)
            .putExtra(AndroidMediaSessionService.EXTRA_STATE,
                "{\"title\":\"Lifecycle regression\",\"playbackState\":\"paused\",\"duration\":60,\"actions\":[\"play\"]}");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.getBridge().getWebView().loadUrl("about:blank"));
            try {
                ContextCompat.startForegroundService(context, update);
                awaitForeground(context);
                java.lang.reflect.Field field = AndroidMediaSessionService.class.getDeclaredField("activeService");
                field.setAccessible(true);
                Service service = (Service) ((WeakReference<?>) field.get(null)).get();
                assertNotNull(service);
                // Android can demote the service without destroying its cached notification state.
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> service.stopForeground(Service.STOP_FOREGROUND_REMOVE));
                long deadline = SystemClock.uptimeMillis() + 2000;
                while (hasForegroundNotification(context) && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(20);
                assertFalse(hasForegroundNotification(context));
                ContextCompat.startForegroundService(context, update);
                awaitForeground(context);
            } finally {
                context.stopService(update);
            }
        }
    }

    private static boolean hasForegroundNotification(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return Arrays.stream(manager.getActiveNotifications()).anyMatch(n ->
            n.getId() == 0x4d454449 && (n.getNotification().flags & Notification.FLAG_FOREGROUND_SERVICE) != 0);
    }

    private static void awaitForeground(Context context) {
        long deadline = SystemClock.uptimeMillis() + 3000;
        while (!hasForegroundNotification(context) && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(20);
        assertTrue("Every foreground service start must acknowledge even unchanged notification content", hasForegroundNotification(context));
    }
}
