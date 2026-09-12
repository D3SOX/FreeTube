package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.os.SystemClock;
import android.os.Looper;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Arrays;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

@RunWith(AndroidJUnit4.class)
public class SubscriptionRefreshLifecycleTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Before
    public void resetCoordinator() {
        SubscriptionRefreshCoordinator.resetForTest();
    }

    @Test
    public void removingTaskKeepsRefreshRunningAcrossFeedsAndReopening() throws Exception {
        AtomicReference<String> token = new AtomicReference<>();
        AtomicReference<SubscriptionRefreshPlugin> retained = new AtomicReference<>();
        AtomicReference<WebView> webView = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> {
                    // Exercise the real plugin and worker without network requests or profile changes.
                    activity.getBridge().getWebView().loadUrl("about:blank");
                    SubscriptionRefreshPlugin plugin = plugin(activity);
                    retained.set(plugin);
                    beginBatch(plugin);
                    webView.set(activity.getBridge().getWebView());
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
                assertTrue("refresh continues after recents dismissal", SubscriptionRefreshCoordinator.isActive());
                assertTrue(hasRefreshNotification());
                assertTrue(SubscriptionRefreshWorker.update(context, token.get(), 14));
                assertEquals("42", javascript(webView.get(), "21 * 2"));

                // Refresh All starts another feed before the detached renderer goes idle.
                finishFeed(retained.get(), token.get());
                Thread.sleep(1500);
                assertTrue("queued feed survives a slow transition", retained.get().isRendererRetained());
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                    JSObject next = start(retained.get());
                    assertTrue(next.getBool("acquired"));
                    token.set(next.getString("token"));
                });
                Thread.sleep(1200);
                assertTrue("next feed retains the executor", retained.get().isRendererRetained());
                assertTrue(SubscriptionRefreshWorker.update(context, token.get(), 15));

                // A reopened activity must neither take ownership nor disconnect cleanup.
                try (ActivityScenario<MainActivity> reopened = ActivityScenario.launch(MainActivity.class)) {
                    reopened.onActivity(activity -> {
                        activity.getBridge().getWebView().loadUrl("about:blank");
                        assertFalse(start(plugin(activity)).getBool("acquired"));
                    });
                    assertEquals("43", javascript(webView.get(), "21 * 2 + 1"));
                    finishFeed(retained.get(), token.get());
                    retained.get().endBatch(emptyCall("endBatch", new JSObject()));
                    await("retained renderer released", () -> !retained.get().isRendererRetained());
                    await("refresh notification removed", () -> !hasRefreshNotification());
                    assertFalse(SubscriptionRefreshCoordinator.isActive());
                }
            } finally {
                if (token.get() != null) SubscriptionRefreshWorker.finish(context, token.get());
                if (retained.get() != null) {
                    await("retained renderer cleaned up", () -> !retained.get().isRendererRetained());
                }
            }
        }
    }

    @Test
    public void inFlightResponseIsStoredAndRefreshFinishesAfterTaskRemoval() throws Exception {
        CountDownLatch requested = new CountDownLatch(1);
        CountDownLatch response = new CountDownLatch(1);
        CountDownLatch loaded = new CountDownLatch(1);
        AtomicReference<WebView> view = new AtomicReference<>();
        AtomicReference<SubscriptionRefreshPlugin> retained = new AtomicReference<>();
        String token = null;
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> {
                    retained.set(plugin(activity));
                    view.set(activity.getBridge().getWebView());
                    loadFixture(activity, requested, response, loaded);
                });
                assertTrue("fixture loaded", loaded.await(10, TimeUnit.SECONDS));
                javascript(view.get(), """
                    window.refreshError = null;
                    window.refreshDone = false;
                    (async () => {
                        const refresh = await Capacitor.nativePromise('SubscriptionRefresh', 'start', {
                            title: 'Refreshing subscriptions', cancelLabel: 'Cancel'
                        });
                        if (!refresh.acquired) throw new Error('Refresh not acquired');
                        window.refreshToken = refresh.token;
                        const result = await fetch('/refresh-lifecycle-response').then(r => r.json());
                        await new Promise((resolve, reject) => {
                            const open = indexedDB.open('opentubex-recents-lifecycle-test', 1);
                            open.onupgradeneeded = () => open.result.createObjectStore('results');
                            open.onerror = () => reject(open.error);
                            open.onsuccess = () => {
                                const db = open.result;
                                const tx = db.transaction('results', 'readwrite');
                                tx.objectStore('results').put(result, 'response');
                                tx.oncomplete = () => { db.close(); resolve(); };
                                tx.onerror = () => { db.close(); reject(tx.error); };
                            };
                        });
                        await Capacitor.nativePromise('SubscriptionRefresh', 'update', {
                            token: refresh.token, progress: 100
                        });
                        await Capacitor.nativePromise('SubscriptionRefresh', 'finish', { token: refresh.token });
                        window.refreshDone = true;
                    })().catch(error => { window.refreshError = String(error); });
                    true;
                    """);
                awaitJavascript(view.get(), "typeof window.refreshToken", "\"string\"");
                token = new org.json.JSONArray("[" + javascript(view.get(), "window.refreshToken") + "]").getString(0);
                assertTrue("refresh request started", requested.await(10, TimeUnit.SECONDS));
                await("foreground notification appears", this::hasRefreshNotification);
                scenario.onActivity(MainActivity::finishAndRemoveTask);
                await("activity destroyed", () -> scenario.getState() == Lifecycle.State.DESTROYED);
                assertTrue(retained.get().isRendererRetained());
                response.countDown();
                await("request and database write finish", () -> !SubscriptionRefreshCoordinator.isActive());
                await("finished renderer released", () -> !retained.get().isRendererRetained());
                await("finished notification removed", () -> !hasRefreshNotification());
                assertFalse(SubscriptionRefreshCoordinator.isActive());

                CountDownLatch reopenedLoaded = new CountDownLatch(1);
                try (ActivityScenario<MainActivity> reopened = ActivityScenario.launch(MainActivity.class)) {
                    reopened.onActivity(activity -> {
                        view.set(activity.getBridge().getWebView());
                        loadFixture(activity, requested, response, reopenedLoaded);
                    });
                    assertTrue("reopened fixture loaded", reopenedLoaded.await(10, TimeUnit.SECONDS));
                    javascript(view.get(), """
                        window.storedVideo = null;
                        const open = indexedDB.open('opentubex-recents-lifecycle-test', 1);
                        open.onsuccess = () => {
                            const db = open.result;
                            const tx = db.transaction('results', 'readwrite');
                            const read = tx.objectStore('results').get('response');
                            read.onsuccess = () => { window.storedVideo = read.result.videos[0].videoId; };
                            tx.objectStore('results').delete('response');
                            tx.oncomplete = () => db.close();
                        };
                        true;
                        """);
                    awaitJavascript(view.get(), "window.storedVideo", "\"refresh-fixture\"");
                }
            } finally {
                response.countDown();
                if (token != null) SubscriptionRefreshWorker.finish(context, token);
                if (retained.get() != null) {
                    await("retained renderer cleaned up", () -> !retained.get().isRendererRetained());
                }
            }
        }
    }

    private static void loadFixture(
        MainActivity activity, CountDownLatch requested, CountDownLatch response, CountDownLatch loaded
    ) {
        WebView view = activity.getBridge().getWebView();
        view.setWebViewClient(new OpenTubeXWebViewClient(activity.getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                String path = request.getUrl().getPath();
                if ("/refresh-lifecycle-test.html".equals(path)) {
                    return resource("text/html", "<!doctype html><html><body>Refresh lifecycle fixture</body></html>");
                }
                if ("/refresh-lifecycle-response".equals(path)) {
                    requested.countDown();
                    try {
                        if (!response.await(15, TimeUnit.SECONDS)) return resource("application/json", "{}");
                    } catch (InterruptedException error) {
                        Thread.currentThread().interrupt();
                    }
                    return resource("application/json", "{\"videos\":[{\"videoId\":\"refresh-fixture\"}]}");
                }
                return super.shouldInterceptRequest(webView, request);
            }

            @Override
            public void onPageFinished(WebView webView, String url) {
                super.onPageFinished(webView, url);
                if (url.endsWith("/refresh-lifecycle-test.html")) loaded.countDown();
            }
        });
        view.loadUrl(activity.getBridge().getLocalUrl() + "/refresh-lifecycle-test.html");
    }

    private static WebResourceResponse resource(String type, String body) {
        return new WebResourceResponse(type, "UTF-8",
            new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    private static void awaitJavascript(WebView view, String script, String expected) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 10000;
        String actual;
        do {
            actual = javascript(view, script);
            if (expected.equals(actual)) return;
            Thread.sleep(25);
        } while (SystemClock.elapsedRealtime() < deadline);
        assertEquals(expected, actual);
    }

    @Test
    public void batchSurvivesDismissalBeforeItsFirstFeedStarts() throws Exception {
        AtomicReference<SubscriptionRefreshPlugin> retained = new AtomicReference<>();
        AtomicReference<String> token = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> {
                    activity.getBridge().getWebView().loadUrl("about:blank");
                    retained.set(plugin(activity));
                    beginBatch(retained.get());
                    activity.finishAndRemoveTask();
                });
                await("activity destroyed", () -> scenario.getState() == Lifecycle.State.DESTROYED);
                assertTrue("batch owns renderer before first feed", retained.get().isRendererRetained());
                await("batch foreground notification appears", this::hasRefreshNotification);
                JSObject first = start(retained.get());
                assertTrue(first.getBool("acquired"));
                token.set(first.getString("token"));
                finishFeed(retained.get(), token.get());
                retained.get().endBatch(emptyCall("endBatch", new JSObject()));
                await("completed batch releases renderer", () -> !retained.get().isRendererRetained());
            } finally {
                if (retained.get() != null) retained.get().endBatch(emptyCall("endBatch", new JSObject()));
                if (token.get() != null) SubscriptionRefreshWorker.finish(context, token.get());
            }
        }
    }

    @Test
    public void successfulStartCannotRaceWithRendererDisposal() throws Exception {
        AtomicReference<String> token = new AtomicReference<>();
        AtomicReference<SubscriptionRefreshPlugin> retained = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> {
                    activity.getBridge().getWebView().loadUrl("about:blank");
                    retained.set(plugin(activity));
                    token.set(start(retained.get()).getString("token"));
                });
                await("foreground notification appears", this::hasRefreshNotification);
                scenario.onActivity(MainActivity::finishAndRemoveTask);
                await("activity destroyed", () -> scenario.getState() == Lifecycle.State.DESTROYED);
                synchronized (retained.get()) {
                    SubscriptionRefreshWorker.finish(context, token.get());
                    // The held monitor keeps this exact disposal gate blocked;
                    // unrelated main-thread monitor contention cannot satisfy it.
                    await("cleanup waits at the plugin disposal gate", () -> {
                        Thread main = Looper.getMainLooper().getThread();
                        return main.getState() == Thread.State.BLOCKED &&
                            Arrays.stream(main.getStackTrace()).anyMatch(frame ->
                                frame.getClassName().equals(SubscriptionRefreshPlugin.class.getName()) &&
                                frame.getMethodName().equals("markRendererForDisposal"));
                    });
                    JSObject next = start(retained.get());
                    assertTrue("next start acquires ownership", next.getBool("acquired"));
                    token.set(next.getString("token"));
                }
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {});
                assertTrue("successful start retains its renderer", retained.get().isRendererRetained());
                assertTrue(SubscriptionRefreshCoordinator.isCurrent(token.get()));
            } finally {
                if (token.get() != null) SubscriptionRefreshWorker.finish(context, token.get());
                if (retained.get() != null) {
                    await("retained renderer cleaned up", () -> !retained.get().isRendererRetained());
                }
            }
        }
    }

    @Test
    public void notificationCancellationReleasesDismissedRenderer() throws Exception {
        AtomicReference<String> token = new AtomicReference<>();
        AtomicReference<SubscriptionRefreshPlugin> retained = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> {
                    activity.getBridge().getWebView().loadUrl("about:blank");
                    retained.set(plugin(activity));
                    beginBatch(retained.get());
                    token.set(start(retained.get()).getString("token"));
                });
                await("foreground notification appears", this::hasRefreshNotification);
                finishFeed(retained.get(), token.get());
                scenario.onActivity(MainActivity::finishAndRemoveTask);
                await("activity destroyed", () -> scenario.getState() == Lifecycle.State.DESTROYED);
                assertTrue(retained.get().isRendererRetained());
                synchronized (retained.get()) {
                    new SubscriptionRefreshCancelReceiver().onReceive(context,
                        new Intent(SubscriptionRefreshCancelReceiver.ACTION_CANCEL)
                            .putExtra(SubscriptionRefreshCancelReceiver.TOKEN_EXTRA, token.get()));
                    assertFalse("cancelled batch cannot start its next feed", start(retained.get()).getBool("acquired"));
                }
                await("cancel releases retained renderer", () -> !retained.get().isRendererRetained());
                await("cancel removes notification", () -> !hasRefreshNotification());
                assertFalse(SubscriptionRefreshCoordinator.isActive());
            } finally {
                if (token.get() != null) SubscriptionRefreshWorker.finish(context, token.get());
                if (retained.get() != null) {
                    await("retained renderer cleaned up", () -> !retained.get().isRendererRetained());
                }
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

    private static void beginBatch(SubscriptionRefreshPlugin plugin) {
        AtomicReference<JSObject> result = new AtomicReference<>();
        plugin.beginBatch(new PluginCall(null, "SubscriptionRefresh", "test", "beginBatch", new JSObject()) {
            @Override public void resolve(JSObject response) { result.set(response); }
        });
        assertTrue("batch acquired", result.get().getBool("acquired"));
    }

    private static void finishFeed(SubscriptionRefreshPlugin plugin, String token) {
        JSObject data = new JSObject();
        data.put("token", token);
        plugin.finish(emptyCall("finish", data));
    }

    private static PluginCall emptyCall(String method, JSObject data) {
        return new PluginCall(null, "SubscriptionRefresh", "test", method, data) {
            @Override public void resolve() {}
        };
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

    private static String javascript(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            view.evaluateJavascript(script, value -> {
                result.set(value);
                evaluated.countDown();
            }));
        assertTrue("dismissed renderer executes JavaScript", evaluated.await(5, TimeUnit.SECONDS));
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
