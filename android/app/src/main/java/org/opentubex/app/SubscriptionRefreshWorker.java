package org.opentubex.app;

import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.ArrayList;
import java.io.File;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

public final class SubscriptionRefreshWorker extends Worker {
    private static final String LOG_TAG = "OpenTubeXFetch";
    private static final String UNIQUE_WORK_NAME = "subscription-refresh";
    private static final String TOKEN_INPUT = "token";
    static final String FEED_TYPE_INPUT = "feedType";
    private static final long MAXIMUM_BATCH_MILLIS = 5 * 60 * 1000;
    private static final SubscriptionRefreshState STATE = new SubscriptionRefreshState();

    static void observeRendererActive(Consumer<Boolean> listener) {
        STATE.observeActive(listener);
    }

    static void removeRendererActiveListener(Consumer<Boolean> listener) {
        STATE.removeActiveListener(listener);
    }

    @FunctionalInterface
    interface ProfileCompletionWriter {
        void write(SubscriptionRefreshConfiguration.Feed profileFeed) throws Exception;
    }

    public SubscriptionRefreshWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static boolean start(Context context, String token, String title, String cancelLabel) {
        if (!SubscriptionRefreshCoordinator.begin(token)) return false;
        STATE.begin(token, title, cancelLabel);
        Data input = new Data.Builder()
            .putString(TOKEN_INPUT, token)
            .putString("cancelLabel", cancelLabel)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(SubscriptionRefreshWorker.class)
            .setInputData(input)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request
        );
        return true;
    }

    static boolean update(Context context, String token, int progress) {
        if (!STATE.update(token, progress)) return false;
        SubscriptionRefreshState.Snapshot snapshot = STATE.takeNotificationSnapshot(token);
        if (snapshot == null) return true;
        context.getSystemService(NotificationManager.class).notify(
            SubscriptionRefreshNotification.NOTIFICATION_ID,
            SubscriptionRefreshNotification.build(
                context,
                token,
                snapshot.title,
                snapshot.cancelLabel,
                snapshot.progress
            )
        );
        return true;
    }

    static boolean finish(Context context, String token) {
        boolean finished = STATE.finish(token);
        SubscriptionRefreshCoordinator.finish(token);
        if (finished) {
            NotificationManager notifications = context.getSystemService(NotificationManager.class);
            notifications.cancel(SubscriptionRefreshNotification.NOTIFICATION_ID);
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME).getResult().addListener(
                () -> notifications.cancel(SubscriptionRefreshNotification.NOTIFICATION_ID),
                ContextCompat.getMainExecutor(context)
            );
        }
        return finished;
    }

    static boolean cancel(Context context, String token) {
        boolean cancelled = SubscriptionRefreshCoordinator.cancel(token);
        STATE.finish(token);
        if (cancelled) {
            context.getSystemService(NotificationManager.class)
                .cancel(SubscriptionRefreshNotification.NOTIFICATION_ID);
        }
        return cancelled;
    }

    @NonNull
    @Override
    public Result doWork() {
        String token = getInputData().getString(TOKEN_INPUT);
        if (token == null) return doScheduledWork();

        return doRendererWork(token);
    }

    private Result doRendererWork(String token) {
        SubscriptionRefreshState.Snapshot snapshot = STATE.snapshot(token);
        if (snapshot == null || !SubscriptionRefreshCoordinator.isCurrent(token)) return Result.success();
        String cancelLabel = getInputData().getString("cancelLabel");
        if (cancelLabel == null) cancelLabel = "Cancel";

        try {
            setForegroundAsync(SubscriptionRefreshNotification.foregroundInfo(
                getApplicationContext(),
                token,
                snapshot.title,
                cancelLabel,
                snapshot.progress
            )).get();
            STATE.awaitCompletion(token);
            return Result.success();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return Result.failure();
        } catch (Exception error) {
            return Result.failure();
        } finally {
            STATE.finish(token);
            if (SubscriptionRefreshCoordinator.finish(token)) {
                getApplicationContext().getSystemService(NotificationManager.class)
                    .cancel(SubscriptionRefreshNotification.NOTIFICATION_ID);
            }
        }
    }

    private Result doScheduledWork() {
        Context context = getApplicationContext();
        if (AppVisibility.isVisible()) return Result.success();
        String feedType = getInputData().getString(FEED_TYPE_INPUT);
        if (feedType == null) return Result.failure();

        List<SubscriptionRefreshConfiguration.Feed> feeds =
            SubscriptionRefreshConfiguration.findFeeds(context, feedType);
        if (feeds.isEmpty()) return Result.success();
        SubscriptionRefreshConfiguration.Feed feed = feeds.get(0);
        Set<String> channelIds = new LinkedHashSet<>();
        for (SubscriptionRefreshConfiguration.Feed profileFeed : feeds) {
            channelIds.addAll(profileFeed.channelIds);
        }

        String token = UUID.randomUUID().toString();
        if (!SubscriptionRefreshCoordinator.begin(token)) return Result.retry();

        int completed = 0;
        int failed = 0;
        Set<String> failedProfileIds = new LinkedHashSet<>();
        SubscriptionRefreshNotificationProgress notificationProgress =
            new SubscriptionRefreshNotificationProgress();
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        try {
            List<String> orderedChannelIds = new ArrayList<>(channelIds);
            SubscriptionRefreshCheckpoint checkpoint = SubscriptionRefreshCheckpoint.load(
                new File(context.getFilesDir(), "subscription-refresh-" + feedType + ".properties"),
                SubscriptionRefreshCheckpoint.configurationId(feeds),
                orderedChannelIds.size()
            );
            completed = checkpoint.completed;
            failed = checkpoint.failed;
            failedProfileIds.addAll(checkpoint.failedProfileIds);
            long batchStartedAt = SystemClock.elapsedRealtime();
            // A periodic job may recreate the process while the app is closed, where
            // Android does not allow starting WorkManager's foreground service. Keep
            // the durable work owned by JobScheduler and make its progress visible
            // with a regular notification instead.
            notifications.notify(
                SubscriptionRefreshNotification.NOTIFICATION_ID,
                SubscriptionRefreshNotification.build(
                    context,
                    token,
                    feed.title,
                    feed.cancelLabel,
                    channelIds.isEmpty() ? 100 : (int) Math.round(checkpoint.nextIndex * 100.0 / channelIds.size())
                )
            );

            int total = channelIds.size();
            for (int index = checkpoint.nextIndex; index < orderedChannelIds.size(); index++) {
                if (SubscriptionRefreshCoordinator.isCancelled(token)) {
                    checkpoint.clear();
                    return Result.success();
                }
                if (isStopped() || SystemClock.elapsedRealtime() - batchStartedAt >= MAXIMUM_BATCH_MILLIS) {
                    return Result.retry();
                }
                String channelId = orderedChannelIds.get(index);
                List<String> profileIds = targetProfileIds(feeds, channelId);
                try {
                    JSONObject payload = SubscriptionRefreshHttpClient.fetch(feed, channelId);
                    boolean stored = false;
                    long timestamp = System.currentTimeMillis();
                    for (String profileId : profileIds) {
                        try {
                            SubscriptionRefreshResultStore.writeChannel(
                                context,
                                profileId,
                                feedType,
                                channelId,
                                payload,
                                timestamp
                            );
                            stored = true;
                        } catch (Exception error) {
                            failedProfileIds.add(profileId);
                            recordFailure(
                                context,
                                Collections.singletonList(profileId),
                                feedType,
                                "Android result store",
                                error
                            );
                        }
                    }
                    if (stored) {
                        try { YtDlpDownloads.get(context).discover(channelId, feedType, payload); }
                        catch (Exception error) { android.util.Log.w("OpenTubeXYtDlp", "Unable to queue automatic downloads", error); }
                        completed++;
                    } else {
                        failed++;
                    }
                } catch (Exception error) {
                    failed++;
                    failedProfileIds.addAll(profileIds);
                    recordFailure(
                        context,
                        profileIds,
                        feedType,
                        "Invidious API",
                        error
                    );
                }

                checkpoint.save(index + 1, completed, failed, failedProfileIds);
                int progress = total == 0 ? 100 : (int) Math.round((completed + failed) * 100.0 / total);
                if (notificationProgress.advanceTo(progress)) {
                    notifications.notify(
                        SubscriptionRefreshNotification.NOTIFICATION_ID,
                        SubscriptionRefreshNotification.build(
                            context,
                            token,
                            feed.title,
                            feed.cancelLabel,
                            progress
                        )
                    );
                }
            }

            if (SubscriptionRefreshCoordinator.isCancelled(token)) {
                checkpoint.clear();
                return Result.success();
            }
            if (isStopped()) return Result.retry();
            if (failed > 0 && completed == 0 && !channelIds.isEmpty()) {
                checkpoint.clear();
                return Result.retry();
            }

            long completionTimestamp = System.currentTimeMillis();
            Set<String> completionFailedProfileIds = new LinkedHashSet<>();
            writeProfileCompletions(
                feeds,
                failedProfileIds,
                profileFeed -> {
                    SubscriptionRefreshResultStore.clearFailure(
                        context,
                        profileFeed.profileId,
                        feedType
                    );
                    SubscriptionRefreshResultStore.writeCompletion(
                        context,
                        profileFeed.profileId,
                        feedType,
                        completionTimestamp
                    );
                },
                (profileFeed, error) -> {
                    completionFailedProfileIds.add(profileFeed.profileId);
                    recordFailure(
                        context,
                        Collections.singletonList(profileFeed.profileId),
                        feedType,
                        "Android result store",
                        error
                    );
                }
            );
            if (!completionFailedProfileIds.isEmpty()) return Result.retry();
            checkpoint.clear();
            return Result.success();
        } catch (Exception error) {
            List<String> profileIds = new ArrayList<>();
            for (SubscriptionRefreshConfiguration.Feed profileFeed : feeds) {
                profileIds.add(profileFeed.profileId);
            }
            recordFailure(
                context,
                profileIds,
                feedType,
                "Android background worker",
                error
            );
            return Result.retry();
        } finally {
            if (SubscriptionRefreshCoordinator.finish(token)) {
                notifications.cancel(SubscriptionRefreshNotification.NOTIFICATION_ID);
            }
        }
    }

    static List<String> targetProfileIds(
        List<SubscriptionRefreshConfiguration.Feed> feeds,
        String channelId
    ) {
        List<String> profileIds = new ArrayList<>();
        for (SubscriptionRefreshConfiguration.Feed feed : feeds) {
            if (feed.channelIds.contains(channelId)) profileIds.add(feed.profileId);
        }
        return profileIds;
    }

    static void writeProfileCompletions(
        List<SubscriptionRefreshConfiguration.Feed> feeds,
        Set<String> failedProfileIds,
        ProfileCompletionWriter writer,
        BiConsumer<SubscriptionRefreshConfiguration.Feed, Exception> onFailure
    ) {
        for (SubscriptionRefreshConfiguration.Feed profileFeed : feeds) {
            if (failedProfileIds.contains(profileFeed.profileId)) continue;
            try {
                writer.write(profileFeed);
            } catch (Exception error) {
                onFailure.accept(profileFeed, error);
            }
        }
    }

    private static void recordFailure(
        Context context,
        List<String> profileIds,
        String feedType,
        String backend,
        Throwable error
    ) {
        SubscriptionRefreshRequestDiagnostic diagnostic =
            SubscriptionRefreshRequestDiagnostic.create(feedType, backend, error);
        Log.w(LOG_TAG, diagnostic.toString());
        long timestamp = System.currentTimeMillis();
        for (String profileId : profileIds) {
            try {
                SubscriptionRefreshResultStore.writeFailure(
                    context,
                    profileId,
                    feedType,
                    diagnostic,
                    timestamp
                );
            } catch (Exception storageError) {
                Log.e(
                    LOG_TAG,
                    "Unable to persist a subscription request diagnostic: " +
                        storageError.getClass().getSimpleName()
                );
            }
        }
    }
}
