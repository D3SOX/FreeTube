package org.opentubex.app;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.function.Consumer;

final class SubscriptionRefreshState {
    static final class Snapshot {
        final String token;
        final String title;
        final String cancelLabel;
        final int progress;

        Snapshot(String token, String title, String cancelLabel, int progress) {
            this.token = token;
            this.title = title;
            this.cancelLabel = cancelLabel;
            this.progress = progress;
        }
    }

    private String token;
    private String title;
    private String cancelLabel;
    private int progress;
    private final SubscriptionRefreshNotificationProgress notificationProgress =
        new SubscriptionRefreshNotificationProgress();
    private CountDownLatch completion = new CountDownLatch(0);
    private final List<Consumer<Boolean>> activeListeners = new ArrayList<>();

    synchronized void observeActive(Consumer<Boolean> listener) {
        activeListeners.add(listener);
        listener.accept(token != null);
    }

    synchronized void removeActiveListener(Consumer<Boolean> listener) {
        activeListeners.remove(listener);
    }

    synchronized void begin(String nextToken, String nextTitle, String nextCancelLabel) {
        completion.countDown();
        token = nextToken;
        title = nextTitle;
        cancelLabel = nextCancelLabel;
        progress = 0;
        notificationProgress.reset();
        completion = new CountDownLatch(1);
        for (Consumer<Boolean> listener : new ArrayList<>(activeListeners)) listener.accept(true);
    }

    synchronized Snapshot nextFeed(String expectedToken, String nextTitle, String nextCancelLabel) {
        if (!isCurrent(expectedToken)) return null;
        title = nextTitle;
        cancelLabel = nextCancelLabel;
        progress = 0;
        notificationProgress.reset();
        // Keep the worker's completion latch while advancing the batch.
        return snapshot(expectedToken);
    }

    synchronized boolean update(String expectedToken, int nextProgress) {
        if (!isCurrent(expectedToken)) return false;
        progress = Math.max(0, Math.min(100, nextProgress));
        return true;
    }

    synchronized Snapshot snapshot(String expectedToken) {
        if (!isCurrent(expectedToken)) return null;
        return new Snapshot(token, title, cancelLabel, progress);
    }

    synchronized Snapshot takeNotificationSnapshot(String expectedToken) {
        if (!isCurrent(expectedToken) || !notificationProgress.advanceTo(progress)) return null;
        return new Snapshot(token, title, cancelLabel, progress);
    }

    void awaitCompletion(String expectedToken) throws InterruptedException {
        CountDownLatch activeCompletion;
        synchronized (this) {
            if (!isCurrent(expectedToken)) return;
            activeCompletion = completion;
        }
        activeCompletion.await();
    }

    synchronized boolean finish(String expectedToken) {
        if (!isCurrent(expectedToken)) return false;
        token = null;
        title = null;
        cancelLabel = null;
        progress = 0;
        notificationProgress.reset();
        completion.countDown();
        for (Consumer<Boolean> listener : new ArrayList<>(activeListeners)) listener.accept(false);
        return true;
    }

    private boolean isCurrent(String expectedToken) {
        return token != null && token.equals(expectedToken);
    }
}
