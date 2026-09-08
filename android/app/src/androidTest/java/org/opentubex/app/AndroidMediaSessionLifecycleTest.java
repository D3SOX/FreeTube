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
    @Test public void activityTeardownAfterUpdateDoesNotCrashTheProcess() throws Exception {
        assertActivityTeardown(false);
    }

    @Test public void queuedUpdateCannotRestartPlaybackAfterActivityTeardown() throws Exception {
        assertActivityTeardown(true);
    }

    private void assertActivityTeardown(boolean beforeStartup) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        java.util.concurrent.CountDownLatch destroyed = new java.util.concurrent.CountDownLatch(1);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().loadUrl("about:blank");
                AndroidMediaSessionPlugin plugin = (AndroidMediaSessionPlugin)
                    activity.getBridge().getPlugin("AndroidMediaSession").getInstance();
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("state", new com.getcapacitor.JSObject()
                    .put("title", "Activity teardown regression")
                    .put("playbackState", "paused"));
                Runnable destroy = () -> {
                    // Replay activity cleanup before Android delivers onStartCommand.
                    // Finishing alone leaves that ordering up to the system scheduler.
                    plugin.handleOnDestroy();
                    activity.finish();
                    destroyed.countDown();
                };
                plugin.update(new com.getcapacitor.PluginCall(null, "AndroidMediaSession", "test", "update", data) {
                    @Override public void resolve() {
                        if (!beforeStartup) destroy.run();
                    }
                });
                if (beforeStartup) destroy.run();
            });
            assertTrue(destroyed.await(3, java.util.concurrent.TimeUnit.SECONDS));
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.DESTROYED);
            SystemClock.sleep(1500);
            assertFalse("activity teardown removes media controls", hasForegroundNotification(context));
        }
    }

    @Test public void obsoleteOwnerStillAcknowledgesForegroundStartup() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.getBridge().getWebView().loadUrl("about:blank"));
            // The owner can change between the plugin's check and service delivery.
            ContextCompat.startForegroundService(context, new Intent(context, AndroidMediaSessionService.class)
                .setAction(AndroidMediaSessionService.ACTION_UPDATE)
                .putExtra(AndroidMediaSessionService.EXTRA_STATE,
                    "{\"nativeOwner\":\"previous-video\",\"title\":\"Obsolete owner\",\"playbackState\":\"paused\"}"));
            SystemClock.sleep(1500);
            assertFalse("obsolete playback must not leave a notification", hasForegroundNotification(context));
        }
    }

    @Test public void clearingImmediatelyAfterUpdateDoesNotCrashTheProcess() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.getBridge().getWebView().loadUrl("about:blank"));
            for (int iteration = 0; iteration < 10; iteration++) {
                java.util.concurrent.CountDownLatch cleared = new java.util.concurrent.CountDownLatch(1);
                scenario.onActivity(activity -> {
                    AndroidMediaSessionPlugin plugin = (AndroidMediaSessionPlugin)
                        activity.getBridge().getPlugin("AndroidMediaSession").getInstance();
                    com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                    data.put("state", new com.getcapacitor.JSObject()
                        .put("title", "Rapid navigation regression")
                        .put("playbackState", "paused"));
                    plugin.update(new com.getcapacitor.PluginCall(null, "AndroidMediaSession", "test", "update", data) {
                        @Override public void resolve() {}
                    });
                    plugin.clear(new com.getcapacitor.PluginCall(null, "AndroidMediaSession", "test", "clear", new com.getcapacitor.JSObject()) {
                        @Override public void resolve() { cleared.countDown(); }
                    });
                });
                assertTrue(cleared.await(3, java.util.concurrent.TimeUnit.SECONDS));
                SystemClock.sleep(200);
            }
            // Android reports stopping an unacknowledged foreground start asynchronously.
            SystemClock.sleep(1000);
            assertFalse("clearing playback removes its notification", hasForegroundNotification(context));
        }
    }

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
