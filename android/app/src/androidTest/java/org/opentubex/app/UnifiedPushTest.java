package org.opentubex.app;

import static org.junit.Assert.*;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.service.notification.StatusBarNotification;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.Before;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class UnifiedPushTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final Context testContext = InstrumentationRegistry.getInstrumentation().getContext();

    @Before public void startTestDistributor() throws Exception {
        // A newly installed distributor must be started before normal registration broadcasts.
        CountDownLatch started = new CountDownLatch(1);
        testContext.sendOrderedBroadcast(new Intent("org.opentubex.test.START")
            .setComponent(new ComponentName(testContext.getPackageName(), UnifiedPushTestDistributor.class.getName()))
            .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES), null, new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) { started.countDown(); }
            }, null, 0, null, null);
        assertTrue(started.await(5, TimeUnit.SECONDS));
    }

    @Test public void bridgeRegistersRotatesAndDisconnects() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            call(scenario, "unregister", "{}");
            JSONObject initial = new JSONObject(call(scenario, "getState", "{}"));
            assertFalse(initial.getBoolean("enabled"));
            assertTrue(initial.getJSONArray("distributors").toString().contains(testContext.getPackageName()));
            register(scenario);
            awaitStatus("registered");
            JSONObject subscription = new JSONObject(call(scenario, "getSubscription", "{}")).getJSONObject("subscription");
            assertEquals("https://push.example.test/first", subscription.getString("endpoint"));
            assertTrue(subscription.getJSONObject("keys").getString("p256dh").length() > 40);
            send("NEW_ENDPOINT", new Intent().putExtra("endpoint", "https://push.example.test/rotated"));
            awaitCondition(() -> "https://push.example.test/rotated".equals(UnifiedPushState.read(context).optJSONObject("subscription").optString("endpoint")));
            assertEquals("https://push.example.test/rotated", new JSONObject(call(scenario, "getSubscription", "{}"))
                .getJSONObject("subscription").getString("endpoint"));
            send("REGISTRATION_FAILED", new Intent().putExtra("reason", "VAPID_REQUIRED"));
            awaitStatus("error");
            assertFalse(new JSONObject(call(scenario, "getState", "{}")).getBoolean("hasSubscription"));
            register(scenario);
            awaitStatus("registered");
            call(scenario, "unregister", "{}");
            send("NEW_ENDPOINT", new Intent().putExtra("endpoint", "https://push.example.test/late"));
            send("MESSAGE", new Intent().putExtra("payload", payload("Disconnected", false)));
            Thread.sleep(1000);
            assertFalse(UnifiedPushState.read(context).optBoolean("enabled"));
            assertNull(notification());
        } finally { reset(); }
    }

    @Test public void receivesWithActivityClosedAndRejectsInvalidMessages() throws Exception {
        try {
            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
                ready(scenario);
                call(scenario, "unregister", "{}");
                register(scenario);
                awaitStatus("registered");
            }
            send("MESSAGE", new Intent().putExtra("payload", payload("Background video", true)));
            awaitCondition(() -> notification() != null);
            assertEquals("Background video", notification().extras.getString(Notification.EXTRA_TITLE));
            assertNotNull(notification().contentIntent);
            assertEquals(context.getPackageName(), notification().contentIntent.getCreatorPackage());
            context.getSystemService(NotificationManager.class).cancel(UnifiedPushService.NOTIFICATION_ID);
            send("MESSAGE", new Intent().putExtra("payload", "{\"version\":1,\"title\":\"Invalid\",\"videoId\":\"https://evil.test\"}"));
            send("MESSAGE", new Intent().putExtra("payload", payload("Forged", false)).putExtra("token", "not-a-registration-token"));
            Thread.sleep(1000);
            assertNull(notification());
            // Valid delivery still works after malformed and unauthenticated broadcasts.
            send("MESSAGE", new Intent().putExtra("payload", payload("Still connected", false)));
            awaitCondition(() -> notification() != null);
            assertEquals("Still connected", notification().extras.getString(Notification.EXTRA_TITLE));
        } finally { reset(); }
    }

    @Test public void connectorSelectionSurvivesStaleAppStateAndActivityRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            call(scenario, "unregister", "{}");
            register(scenario);
            awaitStatus("registered");
            // Model the state left behind when the connector migrates away from a removed provider.
            // Its selected distributor and live registration already belong to our installed peer.
            synchronized (UnifiedPushState.LOCK) {
                JSONObject stale = UnifiedPushState.read(context);
                stale.put("distributor", "org.opentubex.removed.distributor");
                UnifiedPushState.write(context, stale);
            }
            scenario.recreate();
            ready(scenario);
            JSONObject state = new JSONObject(call(scenario, "getState", "{}"));
            assertEquals(testContext.getPackageName(), state.getString("distributor"));
            awaitStatus("registered");
            assertEquals("https://push.example.test/first", new JSONObject(call(scenario, "getSubscription", "{}"))
                .getJSONObject("subscription").getString("endpoint"));
        } finally { reset(); }
    }

    private void register(ActivityScenario<MainActivity> scenario) throws Exception {
        call(scenario, "register", new JSONObject().put("distributor", testContext.getPackageName()).toString());
    }

    private void reset() throws Exception {
        synchronized (UnifiedPushState.LOCK) { UnifiedPushState.write(context, new JSONObject()); }
        org.unifiedpush.android.connector.UnifiedPush.removeDistributor(context);
        context.getSystemService(NotificationManager.class).cancel(UnifiedPushService.NOTIFICATION_ID);
    }

    private String payload(String title, boolean video) throws Exception {
        JSONObject data = new JSONObject().put("version", 1).put("title", title).put("body", "Test notification");
        if (video) data.put("videoId", "dQw4w9WgXcQ");
        return data.toString();
    }

    private void send(String event, Intent extras) {
        testContext.sendBroadcast(new Intent("org.opentubex.test.PUSH")
            .setComponent(new ComponentName(testContext.getPackageName(), UnifiedPushTestDistributor.class.getName()))
            .putExtra("event", event).putExtras(extras));
    }

    private Notification notification() {
        for (StatusBarNotification item : context.getSystemService(NotificationManager.class).getActiveNotifications()) {
            if (item.getId() == UnifiedPushService.NOTIFICATION_ID) return item.getNotification();
        }
        return null;
    }

    private void awaitStatus(String status) throws Exception {
        awaitCondition(() -> status.equals(UnifiedPushState.read(context).optString("status")));
    }

    interface Condition { boolean check() throws Exception; }
    private static void awaitCondition(Condition condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        do { if (condition.check()) return; Thread.sleep(100); } while (System.nanoTime() < deadline);
        fail("Timed out waiting for UnifiedPush callback");
    }

    private static void ready(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitCondition(() -> "true".equals(evaluate(scenario, "typeof window.Capacitor === 'object' && document.readyState === 'complete'")));
    }

    private static String call(ActivityScenario<MainActivity> scenario, String method, String options) throws Exception {
        evaluate(scenario, "window.upResult=null;window.upError=null;window.Capacitor.nativePromise('UnifiedPush','" + method + "'," + options + ")"
            + ".then(v=>{window.upResult=JSON.stringify(v||{});},e=>{window.upError=e.message;});");
        awaitCondition(() -> !"null".equals(evaluate(scenario, "window.upResult")) || !"null".equals(evaluate(scenario, "window.upError")));
        assertEquals("Bridge call must succeed", "null", evaluate(scenario, "window.upError"));
        return new org.json.JSONTokener(evaluate(scenario, "window.upResult")).nextValue().toString();
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value); done.countDown();
        }));
        assertTrue(done.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
