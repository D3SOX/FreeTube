package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Arrays;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

@RunWith(AndroidJUnit4.class)
public class SubscriptionRefreshLifecycleTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void removingTaskFinishesRefreshButBackgroundingDoesNot() throws Exception {
        AtomicReference<String> token = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> {
                    // Exercise the real plugin and worker without network requests or profile changes.
                    activity.getBridge().getWebView().loadUrl("about:blank");
                    SubscriptionRefreshPlugin plugin = plugin(activity);
                    JSObject started = start(plugin);
                    assertTrue(started.getBool("acquired"));
                    token.set(started.getString("token"));
                    // A rejected overlapping start must not lose ownership of the first refresh.
                    assertFalse(start(plugin).getBool("acquired"));
                });
                await("foreground notification appears", this::hasRefreshNotification);
                assertTrue(SubscriptionRefreshWorker.update(context, token.get(), 12));

                scenario.moveToState(Lifecycle.State.CREATED);
                assertTrue(SubscriptionRefreshCoordinator.isCurrent(token.get()));
                assertTrue(hasRefreshNotification());
                assertTrue(SubscriptionRefreshWorker.update(context, token.get(), 13));

                scenario.moveToState(Lifecycle.State.RESUMED);
                scenario.onActivity(MainActivity::finishAndRemoveTask);
                await("activity destroyed", () -> scenario.getState() == Lifecycle.State.DESTROYED);
                await("refresh notification removed", () -> !hasRefreshNotification());
                assertFalse(SubscriptionRefreshCoordinator.isActive());
                assertFalse(SubscriptionRefreshWorker.update(context, token.get(), 14));
            } finally {
                if (token.get() != null) SubscriptionRefreshWorker.finish(context, token.get());
            }
        }
    }

    @Test
    public void destroyingRendererDoesNotFinishAnIndependentRefresh() {
        String token = "independent-scheduled-refresh";
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> {
                    activity.getBridge().getWebView().loadUrl("about:blank");
                    assertTrue(SubscriptionRefreshCoordinator.begin(token));
                    assertFalse(start(plugin(activity)).getBool("acquired"));
                });
                scenario.moveToState(Lifecycle.State.DESTROYED);
                assertTrue(SubscriptionRefreshCoordinator.isCurrent(token));
            } finally {
                SubscriptionRefreshCoordinator.finish(token);
            }
        }
    }

    @Test
    public void queuedStartCannotAcquireWorkAfterRendererDestruction() {
        AtomicReference<SubscriptionRefreshPlugin> plugin = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().loadUrl("about:blank");
                plugin.set(plugin(activity));
            });
            scenario.moveToState(Lifecycle.State.DESTROYED);
            AtomicReference<String> rejection = new AtomicReference<>();
            JSObject data = new JSObject();
            data.put("title", "Refreshing subscription videos");
            plugin.get().start(new PluginCall(null, "SubscriptionRefresh", "test", "start", data) {
                @Override
                public void reject(String message) {
                    rejection.set(message);
                }

                @Override
                public void resolve(JSObject response) {
                    SubscriptionRefreshWorker.finish(context, response.getString("token"));
                }
            });
            assertNotNull("destroyed renderer rejects queued start", rejection.get());
            assertFalse(SubscriptionRefreshCoordinator.isActive());
        }
    }

    private static SubscriptionRefreshPlugin plugin(MainActivity activity) {
        return (SubscriptionRefreshPlugin) activity.getBridge().getPlugin("SubscriptionRefresh").getInstance();
    }

    private static JSObject start(SubscriptionRefreshPlugin plugin) {
        AtomicReference<JSObject> result = new AtomicReference<>();
        JSObject data = new JSObject();
        data.put("title", "Refreshing subscription videos");
        data.put("cancelLabel", "Cancel refresh");
        plugin.start(new PluginCall(null, "SubscriptionRefresh", "test", "start", data) {
            @Override
            public void resolve(JSObject response) {
                result.set(response);
            }
        });
        assertNotNull(result.get());
        return result.get();
    }

    private boolean hasRefreshNotification() {
        return Arrays.stream(context.getSystemService(NotificationManager.class).getActiveNotifications())
            .anyMatch(notification -> notification.getId() == SubscriptionRefreshNotification.NOTIFICATION_ID);
    }

    private static void await(String message, BooleanSupplier condition) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 10000;
        while (!condition.getAsBoolean() && SystemClock.elapsedRealtime() < deadline) {
            Thread.sleep(50);
        }
        assertTrue(message, condition.getAsBoolean());
    }
}
