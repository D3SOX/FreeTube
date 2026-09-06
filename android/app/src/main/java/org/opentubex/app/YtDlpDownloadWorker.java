package org.opentubex.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class YtDlpDownloadWorker extends Worker {
    static final int NOTIFICATION_ID = 0x5954444c;
    private final YtDlpDownloads downloads;
    private final ExecutorService executor = Executors.newFixedThreadPool(10);

    public YtDlpDownloadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
        downloads = YtDlpDownloads.get(context);
    }

    @NonNull @Override public Result doWork() {
        boolean foreground = AppVisibility.isVisible();
        long started = android.os.SystemClock.elapsedRealtime();
        java.util.function.Consumer<org.json.JSONObject> progress = record -> {
            try {
                getApplicationContext().getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(record));
            } catch (Exception error) { android.util.Log.w("OpenTubeXYtDlp", "Unable to update download notification", error); }
        };
        downloads.observe(progress);
        try {
            if (!downloads.hasQueued()) return Result.success();
            if (foreground) setForegroundAsync(foreground()).get();
            else getApplicationContext().getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(null));
            while (!isStopped()) {
                // Closed-app work stays under JobScheduler's execution limit and resumes partial files.
                if (!foreground && android.os.SystemClock.elapsedRealtime() - started > 5 * 60 * 1000) return Result.retry();
                for (long id : downloads.claim()) executor.submit(() -> downloads.run(id));
                synchronized (downloads) {
                    if (!downloads.hasRunning() && !downloads.hasQueued()) return Result.success();
                    downloads.wait(1000);
                }
            }
            return Result.retry();
        } catch (Exception error) {
            return Result.retry();
        } finally {
            downloads.unobserve(progress);
            executor.shutdownNow();
            downloads.stopRunning();
            try { executor.awaitTermination(10, java.util.concurrent.TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            getApplicationContext().getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        }
    }

    @Override public void onStopped() {
        executor.shutdownNow();
        downloads.stopRunning();
    }

    private Notification notification(org.json.JSONObject record) {
        Context context = getApplicationContext();
        String channelId = "yt-dlp-downloads";
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(channelId, "yt-dlp", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        PendingIntent open = PendingIntent.getActivity(context, 0,
            new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, channelId) : new Notification.Builder(context);
        PendingIntent cancel = PendingIntent.getBroadcast(context, 0, new Intent(context, YtDlpCancelReceiver.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int percent = record == null ? 0 : record.optInt("percent");
        return builder.setSmallIcon(R.drawable.ic_stat_opentubex)
            .setContentTitle(record == null ? "yt-dlp" : record.optString("title", "yt-dlp")).setContentIntent(open)
            .setProgress(100, percent, record == null || record.optString("status").equals("processing"))
            .addAction(new Notification.Action.Builder(0, context.getString(android.R.string.cancel), cancel).build())
            .setCategory(Notification.CATEGORY_PROGRESS).setOngoing(true).setOnlyAlertOnce(true).build();
    }

    private ForegroundInfo foreground() {
        Notification notification = notification(null);
        return Build.VERSION.SDK_INT >= 29
            ? new ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            : new ForegroundInfo(NOTIFICATION_ID, notification);
    }
}
