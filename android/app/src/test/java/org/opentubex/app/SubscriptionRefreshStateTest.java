package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Consumer;

public class SubscriptionRefreshStateTest {
    @Test
    public void rendererStaysActiveOnlyUntilItsOwnRefreshFinishes() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        List<Boolean> activity = new ArrayList<>();
        state.observeActive(activity::add);
        state.begin("current", "Refreshing", "Cancel");
        state.finish("stale");
        assertEquals(Arrays.asList(false, true), activity);
        state.finish("current");
        assertEquals(Arrays.asList(false, true, false), activity);
    }

    @Test
    public void recreatedWebViewInheritsActiveRefreshWithoutOldListenerRemovingIt() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        Consumer<Boolean> oldListener = active -> {};
        state.observeActive(oldListener);
        state.begin("current", "Refreshing", "Cancel");
        List<Boolean> activity = new ArrayList<>();
        Consumer<Boolean> newListener = activity::add;
        state.observeActive(newListener);
        state.removeActiveListener(oldListener);
        state.finish("current");
        assertEquals(Arrays.asList(true, false), activity);
        state.removeActiveListener(newListener);
        state.begin("next", "Refreshing", "Cancel");
        assertEquals(Arrays.asList(true, false), activity);
    }

    @Test
    public void reopeningAppDoesNotDisconnectRetainedRenderer() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        List<Boolean> retained = new ArrayList<>();
        state.observeActive(retained::add);
        state.begin("current", "Refreshing", "Cancel");
        List<Boolean> reopened = new ArrayList<>();
        state.observeActive(reopened::add);
        state.finish("current");
        assertEquals(Arrays.asList(false, true, false), retained);
        assertEquals(Arrays.asList(true, false), reopened);
    }

    @Test
    public void onlyCurrentRefreshCanUpdateOrFinish() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        state.begin("current", "Refreshing subscriptions", "Cancel");

        assertFalse(state.update("stale", 50));
        assertFalse(state.finish("stale"));
        assertEquals(0, state.snapshot("current").progress);

        assertTrue(state.update("current", 42));
        assertEquals(42, state.snapshot("current").progress);
        assertTrue(state.finish("current"));
        assertNull(state.snapshot("current"));
    }

    @Test
    public void progressIsClamped() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        state.begin("refresh", "Refreshing subscriptions", "Cancel");

        assertTrue(state.update("refresh", -5));
        assertEquals(0, state.snapshot("refresh").progress);
        assertTrue(state.update("refresh", 130));
        assertEquals(100, state.snapshot("refresh").progress);
    }

    @Test
    public void startingAnotherRefreshInvalidatesThePreviousToken() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        state.begin("first", "Refreshing videos", "Cancel");
        state.begin("second", "Refreshing shorts", "Cancel");

        assertNull(state.snapshot("first"));
        assertEquals("Refreshing shorts", state.snapshot("second").title);
        assertEquals("Cancel", state.snapshot("second").cancelLabel);
    }

    @Test
    public void coalescesNotificationUpdatesForLargeProfiles() {
        SubscriptionRefreshState state = new SubscriptionRefreshState();
        state.begin("refresh", "Refreshing videos", "Cancel");
        int notificationUpdates = 0;

        for (int completed = 1; completed <= 900; completed++) {
            int progress = (int) Math.round(completed * 100.0 / 900);
            assertTrue(state.update("refresh", progress));
            if (state.takeNotificationSnapshot("refresh") != null) {
                notificationUpdates++;
            }
        }

        assertEquals(100, notificationUpdates);
        assertEquals(100, state.snapshot("refresh").progress);
    }
}
